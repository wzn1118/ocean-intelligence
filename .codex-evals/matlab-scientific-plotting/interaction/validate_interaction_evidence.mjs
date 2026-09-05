#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const evidencePath = process.argv[2];
assert(evidencePath, 'Usage: validate_interaction_evidence.mjs <evidence.json>');
const evidence = JSON.parse(readFileSync(path.resolve(evidencePath), 'utf8'));

assert.equal(evidence.schema_version, '1.0');
assert.equal(evidence.scope, 'interaction');
assert.equal(evidence.status, 'passed', 'MATLAB interaction acceptance failed');
assert.match(evidence.generated_at, /^\d{4}-\d{2}-\d{2}T/u);
assert.equal(typeof evidence.matlab_release, 'string');
assert.ok(evidence.matlab_release.length > 0);
assert.equal(typeof evidence.matlab_version, 'string');
assert.equal(typeof evidence.desktop_available, 'boolean');
assert.deepEqual(
  evidence.checks.map((check) => {
    assert.equal(check.status, 'passed', `check failed: ${check.name}`);
    return check.name;
  }),
  [
    'release_datatip_template',
    'callback_five_row_alignment',
    'brush_identity_mapping',
    'linked_time_axes',
    'callback_cleanup',
  ],
);
assert.deepEqual(evidence.error, { identifier: '', message: '' });
console.log(`MATLAB_INTERACTION_EVIDENCE_OK release=${evidence.matlab_release}`);
