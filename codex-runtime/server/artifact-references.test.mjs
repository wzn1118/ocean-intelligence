import assert from 'node:assert/strict';
import test from 'node:test';

import { extractArtifactReferences, normalizeArtifactReference, timestampMilliseconds } from './artifact-references.mjs';

test('normalizes tenant absolute report paths into generated virtual paths', () => {
  assert.equal(
    normalizeArtifactReference('/workspace/.runtime/codex-users/d72f/generated/report.html'),
    'generated/report.html',
  );
  assert.equal(
    normalizeArtifactReference('.runtime/codex-users/d72f/.runtime/codex-uploads/thread/map.png'),
    '.runtime/codex-uploads/thread/map.png',
  );
});

test('extracts report links and plain workspace paths from final messages', () => {
  const references = extractArtifactReferences([
    'HTML：[主报告](/workspace/.runtime/codex-users/d72f/generated/report.html)',
    'Markdown: `generated/report.md`',
  ].join('\n'));
  assert.deepEqual(references.sort(), ['generated/report.html', 'generated/report.md']);
});

test('accepts seconds, milliseconds and ISO thread timestamps', () => {
  assert.equal(timestampMilliseconds(1787965325), 1787965325000);
  assert.equal(timestampMilliseconds(1787965325000), 1787965325000);
  assert.equal(timestampMilliseconds('2026-08-29T01:02:05Z'), 1787965325000);
});
