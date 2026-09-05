#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const evidencePath = process.argv[2];
assert(evidencePath, 'Usage: validate_interaction_evidence.mjs <evidence.json>');
const absoluteEvidencePath = path.resolve(evidencePath);
const evidenceDirectory = path.dirname(absoluteEvidencePath);
const evidence = JSON.parse(readFileSync(absoluteEvidencePath, 'utf8'));

assert.equal(evidence.schema_version, '1.0');
assert.equal(evidence.scope, 'interaction');
assert.ok(['desktop', 'headless'].includes(evidence.mode), 'mode must be desktop or headless');
assert.equal(evidence.status, 'passed', 'MATLAB automated acceptance did not pass');
assert.match(evidence.generated_at, /^\d{4}-\d{2}-\d{2}T/u);
assert.equal(typeof evidence.matlab_release, 'string');
assert.ok(evidence.matlab_release.length > 0);
assert.equal(typeof evidence.matlab_version, 'string');
assert.equal(evidence.desktop_available, evidence.mode === 'desktop');

const expectedChecks = evidence.mode === 'desktop'
  ? ['sorted_identity_mapping', 'desktop_datatip_identity', 'desktop_brush_identity', 'desktop_callback_reentry', 'close_lifecycle_cleanup', 'exception_cleanup']
  : ['sorted_identity_mapping', 'headless_static_fallback', 'close_lifecycle_cleanup', 'exception_cleanup'];
assert.ok(Array.isArray(evidence.checks));
const checkNames = evidence.checks.map((check) => {
  assert.equal(check.status, 'passed', `check failed: ${check.name}`);
  return check.name;
});
assert.deepEqual(checkNames, expectedChecks);

assert.ok(Array.isArray(evidence.artifacts));
assert.deepEqual(evidence.artifacts.map((artifact) => artifact.kind), ['png', 'pdf']);
for (const artifact of evidence.artifacts) {
  assert.equal(path.basename(artifact.file), artifact.file, 'artifact file must be a basename');
  const artifactPath = path.join(evidenceDirectory, artifact.file);
  const stat = statSync(artifactPath);
  assert.ok(stat.isFile() && stat.size > 0, `artifact missing or empty: ${artifact.file}`);
  assert.equal(stat.size, artifact.bytes, `byte count mismatch: ${artifact.file}`);
  const digest = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
  assert.equal(digest, artifact.sha256, `SHA-256 mismatch: ${artifact.file}`);
}

assert.equal(evidence.visual_inspection.required, true);
assert.ok(['pending', 'passed', 'failed'].includes(evidence.visual_inspection.status));
console.log(`MATLAB_INTERACTION_AUTOMATED_EVIDENCE_OK mode=${evidence.mode} visual=${evidence.visual_inspection.status}`);
