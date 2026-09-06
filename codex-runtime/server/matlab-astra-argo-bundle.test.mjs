import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bundleDirectory = new URL('../matlab/tests/model-generated-round24/', import.meta.url);
const provenance = JSON.parse(readFileSync(new URL('generation-provenance.json', bundleDirectory), 'utf8'));
const originals = {
  source: {
    file: 'astra_argo_trial.m', bytes: 22579,
    sha256: 'aaed9d3606d52f43bdefbfe220a6a187e311a4c78109f1191ca3b2c2ad548df0',
  },
  input: {
    file: 'argo-4903822-30d.json', bytes: 58061,
    sha256: '33959a0d9296cf3d0739375d0d551550d493dddbe3aa8cc3606b67ac7df0b7fa',
  },
  report: {
    file: 'astra-argo-round24.md', bytes: 9819,
    sha256: 'b2baec1748545efa399c2458a368c378de678be740679baabcedfafdf4c12099',
  },
  generationPrompt: {
    file: 'generation-prompt.zh.txt', bytes: 4104,
    sha256: '2b2c3c4fc182b0caff4a81e7efee0c9d43e86698dcdc3ae7ed8fb54ccf9f7d52',
  },
  reviewPrompt: {
    file: 'review-prompt.zh.txt', bytes: 1948,
    sha256: '19dada738708de3e5ea9d6d912daf5c4756d6a6d254b570c3c42f22c188cb6b2',
  },
};
const originalBytes = new Map(Object.values(originals).map(({ file }) => [
  file, readFileSync(new URL(file, bundleDirectory)),
]));
const source = originalBytes.get(originals.source.file).toString('utf8');
const profiles = JSON.parse(originalBytes.get(originals.input.file).toString('utf8'));
const profileIDs = ['4903822_067', '4903822_066', '4903822_065'];
const layerCounts = [595, 596, 594];
const variableOrder = [
  'pressure', 'pressure_argoqc', 'salinity', 'salinity_argoqc', 'temperature', 'temperature_argoqc',
];

function assertSourceIncludes(...snippets) {
  for (const snippet of snippets) assert.ok(source.includes(snippet), `Missing static source text: ${snippet}`);
}

for (const [expected, declared] of [
  [originals.source, provenance.source],
  [originals.input, provenance.input],
  [originals.report, provenance.report],
  [originals.generationPrompt, provenance.prompts[0]],
  [originals.reviewPrompt, provenance.prompts[1]],
]) {
  test(`archived original bytes and provenance binding: ${expected.file}`, () => {
    const bytes = originalBytes.get(expected.file);
    assert.equal(bytes.length, expected.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256);
    assert.deepEqual({ file: declared.file, bytes: declared.bytes, sha256: declared.sha256 }, expected);
  });
}

test('provenance retains incomplete generation and the actual interrupted first turn', () => {
  assert.equal(provenance.schema_version, 1);
  assert.equal(provenance.scope,
    'isolated_builtin_codex_argo_candidate_incomplete_generation_and_completed_read_only_review');
  assert.equal(provenance.generated_source_edited, false);
  const generation = provenance.generation;
  assert.equal(generation.generation_status, 'incomplete');
  assert.equal(generation.reason, 'turn_1_deadline_no_retry');
  assert.equal(generation.turns.length, 2);
  const firstTurn = generation.turns[0];
  assert.equal(firstTurn.status, 'interrupted');
  assert.equal(firstTurn.coordinator_result, 'incomplete_no_model_retry');
  assert.equal(firstTurn.output_mode, 'conversation');
  assert.ok(Date.parse(firstTurn.coordinator_interrupted_at) > Date.parse(firstTurn.started_at));
  assert.equal(Object.hasOwn(firstTurn, 'completed_at'), false);
  assert.deepEqual(generation.contexts.map(context => context.turn_id), generation.turns.map(turn => turn.id));
  assert.equal(generation.model_from_both_turn_contexts, 'gpt-6-astra');
  assert.equal(generation.provider_id_from_session_meta, 'OpenAI');
  for (const context of generation.contexts) {
    assert.equal(context.model, generation.model_from_both_turn_contexts);
    assert.equal(context.effort, 'high');
  }
});

test('completed continuation is read-only review, not generation or report completion', () => {
  const [firstTurn, reviewTurn] = provenance.generation.turns;
  assert.equal(reviewTurn.status, 'completed');
  assert.equal(reviewTurn.scope, 'read_only_review_only_no_generation_completion');
  assert.equal(reviewTurn.output_mode, 'illustrated_report');
  assert.ok(Date.parse(reviewTurn.started_at) > Date.parse(firstTurn.coordinator_interrupted_at));
  assert.ok(Date.parse(reviewTurn.completed_at) > Date.parse(reviewTurn.started_at));
  assert.deepEqual(provenance.prompts.map(prompt => prompt.file), [
    originals.generationPrompt.file, originals.reviewPrompt.file,
  ]);
  assert.equal(provenance.review.status, 'completed');
  assert.equal(provenance.review.artifacts_unchanged, true);
  assert.equal(provenance.review.original_rollout_prefix_preserved, true);
  assert.equal(provenance.review.report_id, 'astra-argo-round24');
  assert.equal(provenance.review.report_complete, false);
  assert.equal(provenance.review.report_evidence_ok, false);
  for (const violation of [
    'report-illustrated-evidence-failed', 'report-point-interaction-missing',
    'report-matlab-sources-missing', 'report-matlab-plot-quality-failed',
  ]) assert.ok(provenance.review.report_violations.includes(violation), violation);
});

test('archived static lint status cannot approve MATLAB, visual, interaction, report or score', () => {
  assert.equal(provenance.independent_static_check.tool,
    'MISS_HIT mh_lint --brief --input-encoding utf-8 --matlab 2021a');
  assert.equal(provenance.independent_static_check.status, 'passed');
  assert.equal(provenance.independent_static_check.files, 1);
  assert.equal(provenance.matlab_execution_status, 'not_run');
  for (const field of ['visual_verified', 'native_interaction_verified', 'complete_report_verified']) {
    assert.equal(provenance[field], false, field);
  }
  assert.equal(provenance.score, null);
});

test('four external artifact hashes are declarations only; their files are not inspected', () => {
  const externalDeclarations = [
    {
      path: 'astra-argo-round24-build.mjs', bytes: 38137,
      sha256: '54828522c5f4cb407f4f45f7b9a0df4664c145ffa077625feca460f6f5507906',
    },
    {
      path: 'astra-argo-round24-figures.json', bytes: 12832,
      sha256: 'd4de30b147bedfc08e99eefbc615c4319e801cac6e1a0a5a8ec0b5fa66f6c397',
    },
    {
      path: 'astra-argo-round24-points.html', bytes: 1664512,
      sha256: 'c7bd461ec48afeb15e2769a0540d1954c7cc213b9f009ec5e29114db69489bfb',
    },
    {
      path: 'astra-argo-round24.html', bytes: 14193,
      sha256: '1ba3be4da1d0fe7a33386ab7e6a0c9a192c0a2c5607051cec4d81da7059b5722',
    },
  ];
  const artifactDeclaration = ({ file, bytes, sha256 }) => ({ path: file, bytes, sha256 });
  assert.deepEqual(provenance.artifacts.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })), [
    artifactDeclaration(originals.source), ...externalDeclarations, artifactDeclaration(originals.report),
  ]);
  assert.equal(originalBytes.size, 5);
  for (const declared of externalDeclarations) assert.equal(originalBytes.has(declared.path), false);
});

test('structured input retains one platform and original 067/066/065 profile order and counts', () => {
  assert.ok(Array.isArray(profiles));
  assert.deepEqual(profiles.map(profile => profile._id), profileIDs);
  assert.deepEqual(profiles.map(profile => profile.cycle_number), [67, 66, 65]);
  const platforms = new Set(profiles.map(profile => profile._id.split('_')[0]));
  assert.deepEqual([...platforms], ['4903822']);
  const actualCounts = profiles.map(profile => profile.data[0].length);
  assert.deepEqual(actualCounts, layerCounts);
  assert.equal(actualCounts.reduce((total, count) => total + count, 0), 1785);
  assert.equal(provenance.input.platform_count, platforms.size);
  assert.equal(provenance.input.profile_count, profiles.length);
  assert.equal(provenance.input.layer_count, 1785);
});

test('six original variables retain units, A data modes and null QC metadata', () => {
  for (const profile of profiles) {
    assert.deepEqual(profile.data_info, [
      variableOrder,
      ['units', 'data_keys_mode'],
      [['decibar', 'A'], [null, null], ['psu', 'A'], [null, null], ['degree_Celsius', 'A'], [null, null]],
    ], profile._id);
  }
});

test('raw arrays are variable-by-layer, finite, pressure-ordered and retain every QC flag', () => {
  const qcCounts = [0, 0, 0];
  for (const [profileIndex, profile] of profiles.entries()) {
    assert.equal(profile.data.length, 6, profile._id);
    for (const [variableIndex, values] of profile.data.entries()) {
      const label = `${profile._id}.${variableOrder[variableIndex]}`;
      assert.ok(Array.isArray(values), label);
      assert.equal(values.length, layerCounts[profileIndex], label);
      assert.ok(values.every(Number.isFinite), label);
    }
    const pressure = profile.data[0];
    assert.ok(pressure.every((value, index) => index === 0 || value > pressure[index - 1]), profile._id);
    for (const [qcIndex, variableIndex] of [1, 3, 5].entries()) {
      assert.ok(profile.data[variableIndex].every(flag => flag === 1), `${profile._id} QC`);
      qcCounts[qcIndex] += profile.data[variableIndex].length;
    }
  }
  assert.deepEqual(qcCounts, [1785, 1785, 1785]);
});

test('UTC instants, longitude-latitude and profile direction retain original metadata', () => {
  assert.deepEqual(profiles.map(profile => profile.timestamp), [
    '2026-08-27T04:54:30.000Z', '2026-08-17T09:52:30.000Z', '2026-08-07T14:51:30.000Z',
  ]);
  assert.deepEqual(profiles.map(profile => profile.geolocation), [
    { type: 'Point', coordinates: [-12.79532, -54.679433333333336] },
    { type: 'Point', coordinates: [-12.436848333333334, -54.64378] },
    { type: 'Point', coordinates: [-12.260258333333333, -54.85381] },
  ]);
  for (const [profileIndex, profile] of profiles.entries()) {
    assert.equal(new Date(profile.timestamp).toISOString(), profile.timestamp);
    if (profileIndex > 0) assert.ok(Date.parse(profile.timestamp) < Date.parse(profiles[profileIndex - 1].timestamp));
    assert.equal(profile.profile_direction, 'A');
    assert.equal(profile.geolocation_argoqc, 1);
    assert.equal(profile.timestamp_argoqc, 1);
  }
});

test('data authenticity and planned physical output remain declarations, not measured evidence', () => {
  assert.equal(provenance.input.synthetic, false);
  assert.equal(provenance.input.upstream_authenticity, 'not_independently_verified');
  assert.equal(provenance.input.pressure_unit, 'decibar');
  assert.equal(provenance.input.uncertainty, 'not_provided');
  const output = provenance.observed_output_contract;
  assert.deepEqual(output.page_inches, [8, 5]);
  assert.deepEqual(output.planned_pixels, [2400, 1500]);
  assert.equal(output.planned_dpi, 300);
  assert.equal(output.interpretation, 'Source declaration only; native figure and all exports pending.');
});

test('static source signature matches the basename and declares hash-checked raw JSON reading', () => {
  const signature = source.match(/^function\s+\[([^\]]+)\]\s*=\s*([A-Za-z]\w*)\(([^)]*)\)/u);
  assert.ok(signature);
  assert.deepEqual(signature.slice(1), ['figureHandle,result', 'astra_argo_trial', 'inputPath']);
  assert.equal(`${signature[2]}.m`, originals.source.file);
  assertSourceIncludes(
    `expectedHash = "${originals.input.sha256}";`,
    'inputHash = string(oi_sha256_file(inputPath));',
    'assert(inputHash == expectedHash,',
    'rawText = fileread(inputPath);',
    'assert(string(oi_sha256_file(inputPath)) == inputHash,',
    'profiles = jsondecode(rawText);',
  );
});

test('static return contract retains RawRecords, RawJSONText and original layer addressing', () => {
  assertSourceIncludes(
    'profileIDs = ["4903822_067";"4903822_066";"4903822_065"];',
    'expectedCounts = [595;596;594];',
    'i = offset + j;',
    'R.ProfileIndex(i) = p;', 'R.SourceRow(i) = j;', 'R.SourceFileRow(i) = i;',
    'R.TimeText(i) = string(profile.timestamp);',
    'result.RawRecords = R;', 'result.RawJSONText = rawText;',
    'result.SourceDeclarations = sources;', 'result.OriginalDataInfo = dataInfo;',
    'result.OriginalData = sourceData;', 'result.DisplayPermutation = R.SourceFileRow;',
  );
  for (const [variableIndex, variable] of variableOrder.entries()) {
    assertSourceIncludes(`R.${variable}(i) = D(${variableIndex + 1},j);`);
  }
});

test('static HelperResult and live Scatter mapping checks exist without claiming native execution', () => {
  assertSourceIncludes(
    'helperResult = oi_plot_ts_diagram(axesHandle,R.salinity,R.temperature,R.pressure,options);',
    'result.HelperResult = helperResult;',
    'rows = find(helperResult.CompleteMask & R.ProfileIndex == p);',
    'scatterHandle = helperResult.Scatter(p);',
    'assert(numel(scatterHandle.XData) == numel(rows),',
    'i = rows(j);',
    'assert(scatterHandle.XData(j) == R.salinity(i)',
    '&& scatterHandle.YData(j) == R.temperature(i)',
    '&& scatterHandle.CData(j) == R.pressure(i)',
    "graphicalMap{p} = struct('Scatter',scatterHandle,'ProfileID',profileIDs(p),",
    "'RawRecordRows',rows,'ObservationID',R.ObservationID(rows),",
    "'SourceRow',R.SourceRow(rows),'SourceFileRow',R.SourceFileRow(rows));",
    "scatterHandle.UserData = struct('OriginalUserData',scatterHandle.UserData,",
    "'RecordMapping',graphicalMap{p},'RawRecordsField',\"result.RawRecords\");",
    'result.GraphicsRecordMap = graphicalMap;',
  );
});

test('static source keeps export, visual, desktop and scientific-array validation pending', () => {
  assertSourceIncludes(
    "'Export',\"pending\",'NativeReaderAudit',\"pending\",'Visual',\"pending\",",
    "'DesktopInteraction',\"pending\",'HeadlessExport',\"pending\");",
    "'execution_verified',false,'artifact_validation',\"pending\",'visual_inspection',\"pending\",",
    "'complete',false,'exports',[],'warnings',",
    "'desktopVerified',false,",
    "contract.plot_data_evidence = struct('status',\"not_verified\",'input_sha256',inputHash,",
    'Construction assertions only; independent native-array/driver audit pending',
  );
});
