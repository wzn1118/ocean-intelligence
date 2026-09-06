const UTC_DECLARATION = /^UTC(?:[+-]00(?::?00)?)?$/iu;
const MACHINE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})?)?$/u;

export function parseOceanEvidenceTime(value, timezone = 'UTC') {
  if (typeof value !== 'string' || typeof timezone !== 'string' || !UTC_DECLARATION.test(timezone)) return NaN;
  const match = MACHINE_TIME.exec(value);
  if (!match || match[0] !== value) return NaN;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0'));
  const suffix = match[8] ?? 'Z';
  const offsetHour = suffix === 'Z' ? 0 : Number(suffix.slice(1, 3));
  const offsetMinute = suffix === 'Z' ? 0 : Number(suffix.slice(-2));
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return NaN;

  const normalized = match[4] === undefined ? `${value}T00:00:00Z` : match[8] === undefined ? `${value}Z` : value;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return NaN;
  const offsetMilliseconds = (suffix.startsWith('-') ? -1 : 1) * (offsetHour * 60 + offsetMinute) * 60_000;
  const civilTime = new Date(timestamp + offsetMilliseconds);
  const valid = civilTime.getUTCFullYear() === year
    && civilTime.getUTCMonth() + 1 === month
    && civilTime.getUTCDate() === day
    && civilTime.getUTCHours() === hour
    && civilTime.getUTCMinutes() === minute
    && civilTime.getUTCSeconds() === second
    && civilTime.getUTCMilliseconds() === millisecond;
  return valid ? timestamp : NaN;
}
