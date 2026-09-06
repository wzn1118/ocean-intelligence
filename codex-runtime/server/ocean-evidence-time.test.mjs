import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { parseOceanEvidenceTime } from './ocean-evidence-time.mjs';

test('parses only the supported machine forms without losing milliseconds', () => {
  const cases = [
    ['2026-09-03', '2026-09-03T00:00:00.000Z'],
    ['2026-09-03T00:00:00', '2026-09-03T00:00:00.000Z'],
    ['2026-09-03T00:00:00Z', '2026-09-03T00:00:00.000Z'],
    ['2026-09-03T00:00:00.1', '2026-09-03T00:00:00.100Z'],
    ['2026-09-03T00:00:00.01Z', '2026-09-03T00:00:00.010Z'],
    ['2026-09-03T00:00:00.001Z', '2026-09-03T00:00:00.001Z'],
    ['2026-09-03T00:00:00.000', '2026-09-03T00:00:00.000Z'],
    ['2026-09-03T23:59:59.999', '2026-09-03T23:59:59.999Z'],
    ['1970-01-01T00:00:00.001+0000', '1970-01-01T00:00:00.001Z'],
    ['1969-12-31T23:59:59.999Z', '1969-12-31T23:59:59.999Z'],
  ];
  for (const [value, expected] of cases) {
    const timestamp = parseOceanEvidenceTime(value);
    assert.ok(Number.isSafeInteger(timestamp), value);
    assert.equal(new Date(timestamp).toISOString(), expected, value);
  }
  assert.equal(parseOceanEvidenceTime('1970-01-01'), 0);
  assert.equal(parseOceanEvidenceTime('1969-12-31T23:59:59.999Z'), -1);
  assert.equal(parseOceanEvidenceTime('1970-01-01T00:00:00.001'), 1);
});

test('preserves years 0000 through 0099 instead of shifting them to the 1900s', () => {
  for (let year = 0; year < 100; year += 1) {
    const yearText = String(year).padStart(4, '0');
    for (const value of [`${yearText}-01-01`, `${yearText}-12-31T23:59:59.999Z`]) {
      const timestamp = parseOceanEvidenceTime(value);
      assert.ok(Number.isFinite(timestamp), value);
      assert.equal(new Date(timestamp).getUTCFullYear(), year, value);
    }
  }
  assert.equal(parseOceanEvidenceTime('0000-01-01'), -62_167_219_200_000);
  assert.equal(parseOceanEvidenceTime('0099-01-01'), -59_042_995_200_000);
});

test('validates leap days and month lengths by civil components', () => {
  for (const year of ['0000', '0004', '0096', '1600', '2000', '2024', '2400']) {
    const value = `${year}-02-29T23:59:59.999Z`;
    assert.equal(new Date(parseOceanEvidenceTime(value)).toISOString(), value);
  }
  for (const year of ['0001', '0099', '0100', '1700', '1900', '2026', '2100']) {
    assert.ok(Number.isNaN(parseOceanEvidenceTime(`${year}-02-29`)), year);
    assert.ok(Number.isNaN(parseOceanEvidenceTime(`${year}-02-29T12:00:00+08:00`)), year);
  }
  for (const value of ['2026-02-30', '2024-02-30', '2026-04-31', '2026-06-31',
    '2026-09-31', '2026-11-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32']) {
    assert.ok(Number.isNaN(parseOceanEvidenceTime(value)), value);
    assert.ok(Number.isNaN(parseOceanEvidenceTime(`${value}T00:00:00Z`)), value);
  }
  assert.ok(Number.isFinite(parseOceanEvidenceTime('2026-04-30T23:59:59.999Z')));
});

test('converts signed offsets to actual UTC instants including boundary crossings', () => {
  const cases = [
    ['2026-09-03T08:00:00+08:00', '2026-09-03T00:00:00.000Z'],
    ['2026-09-03T08:00:00+0800', '2026-09-03T00:00:00.000Z'],
    ['2026-09-02T16:00:00-08:00', '2026-09-03T00:00:00.000Z'],
    ['2026-09-02T16:00:00-0800', '2026-09-03T00:00:00.000Z'],
    ['2026-09-03T05:30:00.01+05:30', '2026-09-03T00:00:00.010Z'],
    ['2026-09-03T05:45:00.1+0545', '2026-09-03T00:00:00.100Z'],
    ['2026-01-01T00:00:00.001+00:01', '2025-12-31T23:59:00.001Z'],
    ['2026-12-31T23:59:59.999-00:01', '2027-01-01T00:00:59.999Z'],
    ['2024-03-01T00:00:00+00:01', '2024-02-29T23:59:00.000Z'],
    ['2026-01-02T00:00:00+23:59', '2026-01-01T00:01:00.000Z'],
    ['2026-01-01T00:00:00-2359', '2026-01-01T23:59:00.000Z'],
    ['0000-01-01T00:00:00+00:01', '-000001-12-31T23:59:00.000Z'],
    ['0099-01-01T08:00:00+08:00', '0099-01-01T00:00:00.000Z'],
    ['9999-12-31T23:59:59.999-00:01', '+010000-01-01T00:00:59.999Z'],
  ];
  for (const [value, expected] of cases) {
    assert.equal(new Date(parseOceanEvidenceTime(value)).toISOString(), expected, value);
  }
  for (const suffix of ['Z', '+00:00', '-00:00', '+0000', '-0000']) {
    assert.equal(parseOceanEvidenceTime(`1970-01-01T00:00:00${suffix}`), 0, suffix);
  }
  assert.notEqual(parseOceanEvidenceTime('2026-09-03T00:00:00+08:00'),
    parseOceanEvidenceTime('2026-09-03T00:00:00Z'));
});

test('accepts only declared UTC aliases regardless of the timestamp offset', () => {
  const value = '2026-09-03T08:00:00+08:00';
  const expected = parseOceanEvidenceTime('2026-09-03');
  for (const timezone of ['UTC', 'utc', 'UtC', 'UTC+00', 'UTC-00', 'UTC+0000',
    'UTC-0000', 'UTC+00:00', 'UTC-00:00', 'utc+00:00']) {
    assert.equal(parseOceanEvidenceTime(value, timezone), expected, timezone);
    assert.equal(parseOceanEvidenceTime('2026-09-03T00:00:00', timezone), expected, timezone);
  }
  assert.equal(parseOceanEvidenceTime(value, undefined), expected);
  for (const timezone of ['', ' ', ' UTC', 'UTC ', 'UTC\n', 'UTC+08:00', 'UTC-01:00',
    'UTC+00:01', 'UTC+0', 'UTC+000', 'UTC+00:0', 'GMT', 'Z', 'Etc/UTC', 'Asia/Shanghai']) {
    assert.ok(Number.isNaN(parseOceanEvidenceTime(value, timezone)), timezone);
    assert.ok(Number.isNaN(parseOceanEvidenceTime('2026-09-03T00:00:00Z', timezone)), timezone);
  }
});

test('rejects clock and offset overflow rather than normalizing it', () => {
  for (const time of ['24:00:00', '24:00:00.000', '25:00:00', '23:60:00',
    '23:59:60', '99:00:00', '00:99:00', '00:00:99']) {
    for (const suffix of ['', 'Z', '+08:00']) {
      const value = `2026-09-03T${time}${suffix}`;
      assert.ok(Number.isNaN(parseOceanEvidenceTime(value)), value);
    }
  }
  for (const offset of ['+24:00', '-24:00', '+2400', '-2400', '+00:60', '-0060',
    '+23:60', '+99:00', '+08', '+8:00', '+080', '+08000', '+08:0', '+08:000', '+08:00:00']) {
    const value = `2026-09-03T00:00:00${offset}`;
    assert.ok(Number.isNaN(parseOceanEvidenceTime(value)), value);
  }
});

test('rejects unsupported syntax and excess precision without trimming or truncating', () => {
  const values = ['', ' ', '\n', '2026', '2026-09', '2026-9-03', '2026-09-3',
    '2026-09-03Z', '2026-09-03+08:00', '2026-09-03T00:00', '2026-09-03T0:00:00Z',
    '2026-09-03T00:0:00Z', '2026-09-03T00:00:0Z', '2026-09-03 00:00:00Z',
    '2026-09-03t00:00:00Z', '2026-09-03T00:00:00z', '2026-09-03T00:00:00.Z',
    '2026-09-03T00:00:00.0000Z', '2026-09-03T00:00:00.9999',
    '2026-09-03T00:00:00.123456+08:00', '2026-09-03T00:00:00,123Z',
    '2026-09-03T00:00:00Zextra', '2026-09-03T00:00:00Z\n', '2026-09-03\n',
    ' 2026-09-03', '2026-09-03 ', '2026-09-03T00:00:00Z\u0000',
    '2026-09-03T00:00:00+08:00Z', '2026-09-03T00:00:00Z+08:00',
    '+002026-09-03T00:00:00Z', '-000001-09-03T00:00:00Z', '10000-01-01',
    '2026-W36-4', '2026-246', '09/03/2026', 'Thu, 03 Sep 2026 00:00:00 GMT',
    'September 3, 2026', '2026-09-03T00:00:00 UTC', '2026-09-03T00:00:00Z[UTC]'];
  for (const value of values) assert.ok(Number.isNaN(parseOceanEvidenceTime(value)), value);
});

test('rejects non-string inputs and declarations without coercion or exceptions', () => {
  const coercionTrap = { toString() { throw new Error('Unexpected coercion'); } };
  const invalid = [undefined, null, true, false, 0, 123, NaN, Infinity, 0n,
    Symbol('UTC'), [], ['UTC'], {}, new String('UTC'), new Date(0), coercionTrap];
  assert.ok(Number.isNaN(parseOceanEvidenceTime()));
  for (const value of invalid) assert.ok(Number.isNaN(parseOceanEvidenceTime(value)));
  for (const timezone of invalid.filter(value => value !== undefined)) {
    assert.ok(Number.isNaN(parseOceanEvidenceTime('2026-09-03', timezone)));
  }
});

test('leaves equal endpoints and interval ordering to the caller', () => {
  const start = parseOceanEvidenceTime('2026-09-03');
  const sameEnd = parseOceanEvidenceTime('2026-09-03T08:00:00+08:00');
  const earlierEnd = parseOceanEvidenceTime('2026-09-02T23:59:59.999Z');
  assert.equal(start, sameEnd);
  assert.ok(Number.isFinite(earlierEnd) && earlierEnd < start);
});

test('returns identical results in two child processes with different host timezones', () => {
  const samples = ['2026-09-03', '2026-09-03T00:00:00', '2026-09-03T01:00:00Z',
    '2026-09-03T08:00:00.123+08:00', '1969-12-31T23:59:59.999',
    '0000-01-01', '0099-02-28T23:59:59.999', '2024-02-29T00:00:00-0500',
    '2026-02-30T00:00:00Z', '2026-09-03T24:00:00', '2026-09-03T00:00:00.0001Z'];
  const expected = samples.map(value => {
    const timestamp = parseOceanEvidenceTime(value);
    return Number.isNaN(timestamp) ? null : timestamp;
  });
  const moduleUrl = new URL('./ocean-evidence-time.mjs', import.meta.url).href;
  const script = `
    import { parseOceanEvidenceTime } from ${JSON.stringify(moduleUrl)};
    const values = ${JSON.stringify(samples)}.map(value => {
      const timestamp = parseOceanEvidenceTime(value);
      return Number.isNaN(timestamp) ? null : timestamp;
    });
    process.stdout.write(JSON.stringify({ values, hostOffset: new Date(2026, 8, 3).getTimezoneOffset() }));
  `;
  const hostOffsets = [];
  for (const timezone of ['UTC', 'America/New_York']) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(child.error, undefined, timezone);
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.deepEqual(result.values, expected, timezone);
    hostOffsets.push(result.hostOffset);
  }
  assert.equal(hostOffsets[0], 0);
  assert.notEqual(hostOffsets[0], hostOffsets[1]);
});
