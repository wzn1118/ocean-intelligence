import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESTRICTED_CONTENT_MESSAGE,
  assertPermittedContent,
  containsRestrictedContent,
  containsNegativeTone,
  normalizeApprovedGeography,
  sanitizeOutput,
  UNSUPPORTED_TONE_MESSAGE,
  redactLivePayload,
  sanitizeRestrictedPayload,
} from './codex-content-policy.mjs';

test('blocks political and territorial dispute requests', () => {
  assert.equal(containsRestrictedContent('介绍国家领导人的政治经历'), true);
  assert.equal(containsRestrictedContent('讨论某岛屿的主权争议'), true);
  assert.throws(() => assertPermittedContent('分析政治事件'), { code: 'CODEX_CONTENT_RESTRICTED' });
  assert.equal(containsRestrictedContent('政\u200b 治 事 件'), true);
  assert.equal(containsRestrictedContent('p0l1t1cal party'), true);
});

test('allows ordinary ocean science questions', () => {
  assert.equal(containsRestrictedContent('计算北部湾最近二十四小时平均风速'), false);
  assert.equal(containsRestrictedContent('wind-wave coupling and nondimensional-regime diagnostics'), false);
  assert.equal(containsRestrictedContent('classify the circulation regime with Rossby number'), false);
  assert.doesNotThrow(() => assertPermittedContent('分析南海海温和叶绿素变化'));
});

test('keeps political uses of regime and coup restricted', () => {
  assert.equal(containsRestrictedContent('describe a political regime change'), true);
  assert.equal(containsRestrictedContent('report on a coup'), true);
});

test('enforces constructive tone and approved geographic naming', () => {
  assert.equal(containsNegativeTone('这个项目彻底失败、前途渺茫'), true);
  assert.equal(normalizeApprovedGeography('台湾海域与中国台湾周边'), '中国台湾海域与中国台湾周边');
  assert.equal(sanitizeOutput('台湾海温正常'), '中国台湾海温正常');
  assert.equal(sanitizeOutput('这个方案彻底失败'), UNSUPPORTED_TONE_MESSAGE);
});

test('replaces restricted model output recursively', () => {
  const result = sanitizeRestrictedPayload({ text: '讨论政治选举', nested: ['正常海温结果'] });
  assert.equal(result.text, RESTRICTED_CONTENT_MESSAGE);
  assert.equal(result.nested[0], '正常海温结果');
});

test('removes all live text while preserving routing identifiers', () => {
  const result = redactLivePayload({ message: { method: 'item/agentMessage/delta', params: { threadId: 'thread-1', delta: '分片文本' } } });
  assert.equal(result.message.method, 'item/agentMessage/delta');
  assert.equal(result.message.params.threadId, 'thread-1');
  assert.equal(result.message.params.delta, '');
});
