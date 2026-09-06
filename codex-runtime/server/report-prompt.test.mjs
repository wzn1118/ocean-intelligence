import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Script } from 'node:vm';
import test from 'node:test';
import { parse } from 'acorn';

import { createIllustratedReportContract, illustratedReportInstructions, inspectReportMatlabSources } from './illustrated-report-contract.mjs';

const runtimeSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
const runtimeAst = parse(runtimeSource, { ecmaVersion: 'latest', sourceType: 'module' });
const repositorySkill = readFileSync(new URL('../matlab/SKILL.md', import.meta.url), 'utf8');
const repositoryReadme = readFileSync(new URL('../matlab/README.md', import.meta.url), 'utf8');

function initializer(name) {
  const declarations = [];
  function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === name) declarations.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(runtimeAst);
  assert.equal(declarations.length, 1, name);
  const expression = declarations[0].init;
  return new Script(`(${runtimeSource.slice(expression.start, expression.end)})`);
}

const manifestExpression = initializer('reportManifestPath');
const directoryExpression = initializer('reportMatlabDirectory');
const turnExpression = initializer('turnText');

function renderPrompt({ generatedRoot = '/tmp/synthetic-report-prompt/generated', reportId = 'synthetic-report-prompt', text = 'Bounded source replay', report, body = {} } = {}) {
  const context = {
    report: report === undefined ? createIllustratedReportContract(generatedRoot, reportId) : report,
    tenant: { generatedRoot }, text, body, path, illustratedReportInstructions,
    reportPolicy: { profile: 'matlab-illustrated-v1' },
  };
  context.reportManifestPath = manifestExpression.runInNewContext(context);
  context.reportMatlabDirectory = directoryExpression.runInNewContext(context);
  return { text: turnExpression.runInNewContext(context), directory: context.reportMatlabDirectory, report: context.report };
}

test('actual report prompt fixes the function directory to the bound report id', () => {
  const generatedRoot = '/tmp/synthetic prompt/generated';
  const reportId = 'argo-4903822-round24';
  const report = { ...createIllustratedReportContract(generatedRoot, reportId), sourceDirectory: '/foreign-report' };
  const rendered = renderPrompt({ generatedRoot, reportId, report, body: { sourceDirectory: '/caller-directory', reportMatlabDirectory: '/another-directory' } });
  assert.equal(rendered.directory, path.join(generatedRoot, `${reportId}-matlab`));
  assert.ok(rendered.text.includes(`directly inside ${rendered.directory}`));
  assert.match(rendered.text, /plot_report\.m with primary function plot_report/u);
  assert.match(rendered.text, /legal MATLAB name matching its filename basename/u);
  assert.match(rendered.text, /fixed by the server-bound report id, not a caller-provided path/u);
  assert.doesNotMatch(rendered.text, /foreign-report|caller-directory|another-directory|every source filename beginning/u);
});

test('prompt keeps legacy scripts without requiring hyphenated new function names', () => {
  const { text } = renderPrompt();
  assert.match(text, /Legacy \.m scripts directly under .* whose filenames begin synthetic-report-prompt- remain compatible evidence/u);
  assert.match(text, /does not require new functions to use that prefix/u);
  assert.match(text, /do not put the hyphenated report id into a function name/u);
  assert.match(text, /source references relative to the generated root, including synthetic-report-prompt-matlab\/plot_report\.m/u);
  assert.match(text, /lowercase \.m extension/u);
  assert.match(text, /non-keyword ASCII basenames of 1-63 characters/u);
  assert.match(text, /Do not place subdirectories, symlinks, hardlinks, data, README or export files there/u);
  assert.match(text, /verify which resolves the function to this report/u);
  assert.match(text, /not proof of valid MATLAB syntax or execution/u);
});

test('prompt source location is discovered by the implemented contract alongside legacy scripts', (context) => {
  const generatedRoot = mkdtempSync(path.join(os.tmpdir(), 'report-prompt-source-'));
  context.after(() => rmSync(generatedRoot, { recursive: true, force: true }));
  const rendered = renderPrompt({ generatedRoot });
  mkdirSync(rendered.directory);
  const nativeSource = path.join(rendered.directory, 'plot_report.m');
  writeFileSync(nativeSource, 'function result = plot_report()\nresult = [];\nend\n');
  const legacySource = path.join(generatedRoot, `${rendered.report.id}-legacy.m`);
  writeFileSync(legacySource, 'synthetic_value = 1;\n');
  const sources = inspectReportMatlabSources({ outputDirectory: generatedRoot, expectedReportId: rendered.report.id });
  assert.equal(sources.ok, true);
  assert.deepEqual(sources.sourcePaths, [nativeSource, legacySource].sort());
});

test('prompt filename bounds match actual source discovery without certifying execution', (context) => {
  const generatedRoot = mkdtempSync(path.join(os.tmpdir(), 'report-prompt-names-'));
  context.after(() => rmSync(generatedRoot, { recursive: true, force: true }));
  for (const [index, [basename, accepted]] of [['p'.repeat(63), true], ['p'.repeat(64), false], ['if', false]].entries()) {
    const rendered = renderPrompt({ generatedRoot, reportId: `synthetic-report-name-${index}` });
    mkdirSync(rendered.directory);
    writeFileSync(path.join(rendered.directory, `${basename}.m`), 'synthetic_value = 1;\n');
    const sources = inspectReportMatlabSources({ outputDirectory: generatedRoot, expectedReportId: rendered.report.id });
    assert.equal(sources.ok, accepted);
    if (!accepted) assert.ok(sources.violations.some((violation) => violation.endsWith('.invalid_source_name')));
  }
});

test('report prompt derives source scope from current inputs without injecting snapshot facts', () => {
  const { text } = renderPrompt();
  for (const term of ['Reconcile platform, profile and layer/sample counts against this run\'s actual inputs',
    'distinguish discontinuous sampling from continuous coverage', 'never count layers as independent platforms',
    'each variable\'s original mode and units', 'all original QC fields',
    'Pressure is not depth', 'Unknown metadata remains unknown',
    'independent in-situ validation', 'upstream acquisition receipts',
    'update timestamp is not a fetch receipt', 'not a complete ocean-region report',
    'complete=false', 'do not fabricate PNG/PDF, native proof, visual approval or a passing CI result',
    'synthetic benchmark scores', 'full report gates']) assert.ok(text.includes(term), term);
  assert.doesNotMatch(text, /4903822|1785|data_keys_mode\s*=\s*A|degree_Celsius\/psu\/decibar|all five original QC flags|three non-continuous profiles/u);
  assert.match(text, /Do not invent uncertainty, density, named-region or nine-zone coverage/u);
  assert.match(text, /only manifest path is .*synthetic-report-prompt-figures\.json/u);
  assert.match(text, /Every declared export basename must begin synthetic-report-prompt-/u);
  assert.match(text, /Set ExportSVG=false/u);
  assert.match(text, /at least one checked interactive HTML export even when no \.m or point-named file is found/u);
});

test('T-S guidance matches the actual helper without borrowing comparison v3 evidence', () => {
  const { text } = renderPrompt();
  const helper = readFileSync(new URL('../matlab/assets/oi_plot_ts_diagram.m', import.meta.url), 'utf8');
  for (const name of ['ColorLabel', 'ColorUnit', 'ColorLimits', 'CompleteMask', 'Scatter', 'SampleLabels']) {
    assert.ok(helper.includes(`"${name}"`), name);
    assert.ok(text.includes(name), name);
  }
  assert.doesNotMatch(helper, /RawRecords|RecordMetadata|RecordID|UserData/u);
  for (const term of ['Only when generating a pressure-colored T-S plot',
    'ColorLabel="Pressure"', 'ColorUnit equal to the source pressure unit', 'remain "unspecified"',
    'no RawRecords, RecordMetadata or comparison-v3 identity interface',
    'profile-local source rows to concatenated call rows', 'caller-managed UserData on each actual Scatter',
    'read back XData/YData/CData, ownership, visibility, order and identities before/after export',
    'SampleLabels or copied input arrays do not prove native identity',
    'new T-S plot must not claim comparison v3 coverage']) assert.ok(text.includes(term), term);
});

test('conversation turns do not receive report-specific source or replay requirements', () => {
  const text = 'An ordinary conversation, including an Octave question.';
  const rendered = renderPrompt({ report: null, text });
  assert.equal(rendered.text, text);
  assert.equal(rendered.directory, null);
});

test('skill and adjacent README agree on implemented source ownership and replay limits', () => {
  for (const document of [repositorySkill, repositoryReadme]) {
    for (const term of ['generated/<reportId>-matlab/', 'plot_report.m', 'plot_report', '<reportId>-*.m',
      '<reportId>-matlab/plot_report.m', 'which', '1785', 'data_keys_mode=A', 'degree_Celsius',
      'decibar', 'psu', 'complete=false', 'RawRecords', 'RecordMetadata', 'source_row',
      'CompleteMask', 'UserData', 'XData/YData/CData', 'SampleLabels', '1-63']) assert.ok(document.includes(term), term);
    assert.doesNotMatch(document, /matlab\/<validFunction>\.m.*design candidate|固定.*matlab.*仍为设计候选/u);
  }
  assert.match(repositorySkill, /derived from the server-bound report id, never a caller-selected directory/u);
  assert.match(repositorySkill, /Legacy root .* scripts remain compatible evidence/u);
  assert.match(repositorySkill, /not a complete ocean-region report/u);
  assert.match(repositoryReadme, /调用方不能重写/u);
  assert.match(repositoryReadme, /旧根目录 .* 脚本仍兼容/u);
  assert.match(repositoryReadme, /新 T-S 图不得冒充 comparison v3/u);
});
