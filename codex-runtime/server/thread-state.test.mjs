import assert from 'node:assert/strict';
import test from 'node:test';

import { isThreadNotLoaded, threadStatusType } from './thread-state.mjs';

test('recognizes persisted App Server thread states that require resume', () => {
  assert.equal(isThreadNotLoaded({ status: { type: 'notLoaded' } }), true);
  assert.equal(isThreadNotLoaded({ status: 'not_loaded' }), true);
  assert.equal(isThreadNotLoaded({ status: { type: 'idle' } }), false);
});

test('normalizes string and object thread status values', () => {
  assert.equal(threadStatusType('active'), 'active');
  assert.equal(threadStatusType({ type: 'notLoaded' }), 'notLoaded');
  assert.equal(threadStatusType(null), '');
});
