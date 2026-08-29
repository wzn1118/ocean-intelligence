import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectThreadRecovery } from './thread-recovery.mjs';

test('detects an interrupted substantive turn behind an empty interrupted tail', () => {
  const recovery = inspectThreadRecovery({
    turns: [
      { id: 'turn-1', status: 'interrupted', items: [{ type: 'userMessage' }, { type: 'agentMessage' }] },
      { id: 'turn-2', status: 'interrupted', items: [] },
    ],
  });
  assert.equal(recovery.verified, true);
  assert.equal(recovery.meaningfulTurnId, 'turn-1');
  assert.equal(recovery.needsContinuation, true);
  assert.equal(recovery.itemCount, 2);
});

test('does not request continuation after a later completed turn', () => {
  const recovery = inspectThreadRecovery({
    turns: [
      { id: 'turn-1', status: 'interrupted', items: [{ type: 'userMessage' }] },
      { id: 'turn-2', status: 'completed', items: [{ type: 'userMessage' }, { type: 'agentMessage' }] },
    ],
  });
  assert.equal(recovery.meaningfulTurnId, 'turn-2');
  assert.equal(recovery.needsContinuation, false);
});
