import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const assetPath = new URL('../matlab/assets/interactive_timeseries_native_template.m', import.meta.url);
const exportHelperPath = new URL('../matlab/assets/oi_export_figure.m', import.meta.url);
const referencePath = new URL('../matlab/INTERACTIONS.md', import.meta.url);
const acceptancePath = new URL('../../.codex-evals/matlab-100-20260905/interaction/run_interaction_acceptance.m', import.meta.url);
const evidenceValidatorPath = new URL('../../.codex-evals/matlab-100-20260905/interaction/validate_interaction_evidence.mjs', import.meta.url);
const asset = readFileSync(assetPath, 'utf8');
const exportHelper = readFileSync(exportHelperPath, 'utf8');
const reference = readFileSync(referencePath, 'utf8');
const acceptance = readFileSync(acceptancePath, 'utf8');
const evidenceValidator = readFileSync(evidenceValidatorPath, 'utf8');

test('interactive MATLAB asset preserves stable point identity', () => {
  assert.match(asset, /ObservationID values must be unique/u);
  assert.match(asset, /SourceRow must contain unique positive integer source positions/u);
  assert.match(asset, /supplied_pre_filter_identity/u);
  assert.match(asset, /DataTipTemplate requires MATLAB R2019b/u);
  assert.match(asset, /ObservationID, Station, and QCFlag must contain one value per row/u);
  assert.match(asset, /DataTipTemplate\.DataTipRows/u);
  assert.match(asset, /dataTipTextRow\('Observation ID'/u);
  assert.match(asset, /dataTipTextRow\('Source row'/u);
  assert.match(asset, /UserData = struct\('ObservationID'/u);
  assert.match(asset, /BrushData/u);
  assert.match(asset, /SelectedObservationIDs/u);
  assert.match(asset, /normalize_observation_ids/u);
  assert.match(asset, /valid_series_identity/u);
  assert.match(asset, /function selected_ids = get_selected_ids[\s\S]*?\nend\n\nfunction selected_ids = collect_selected_ids/u);
  assert.match(asset, /function identity = collect_selected_identity/u);
  assert.doesNotMatch(asset, /\bgca\b|\bgcf\b/u);
});

test('interactive MATLAB asset preserves scientific point semantics', () => {
  assert.match(asset, /Time\.TimeZone must match the explicitly declared TimeZone/u);
  assert.match(asset, /numel\(time\) == height\(data\)/u);
  assert.match(asset, /axes_handle\.XDir = 'normal'/u);
  assert.match(asset, /Station and QCFlag must be nonempty after trimming/u);
  assert.match(asset, /UncertaintyUnit must match ValueUnit/u);
  assert.match(asset, /Uncertainty bounds must enclose every complete Value/u);
  assert.match(asset, /dataTipTextRow\([\s\S]*Uncertainty:/u);
  assert.match(asset, /QCSummary/u);
  assert.match(asset, /UncertaintyMissingCount/u);
});

test('interactive MATLAB asset owns callback lifecycle', () => {
  assert.match(asset, /ActionPostCallback/u);
  assert.match(asset, /datacursormode\(axes_handles\(axes_index\), 'on'\)/u);
  assert.match(asset, /brush\(axes_handles\(axes_index\), 'on'\)/u);
  assert.doesNotMatch(asset, /=\s*datacursormode\(axes_handles\(axes_index\)/u);
  assert.doesNotMatch(asset, /=\s*brush\(axes_handles\(axes_index\)/u);
  assert.match(asset, /data_cursor_mode\.Enable = 'on'/u);
  assert.match(asset, /brush_mode\.ActionPostCallback/u);
  assert.match(asset, /isappdata\(figure_handle, 'OceanInteractionState'\)/u);
  assert.match(asset, /data_index ~= fix\(data_index\)/u);
  assert.match(asset, /data_index > numel\(target\.YData\)/u);
  assert.match(asset, /safe_metadata_text/u);
  assert.match(asset, /numel\(interaction_state\.DataCursorModes\) >= axes_index/u);
  assert.match(asset, /numel\(interaction_state\.BrushModes\) >= axes_index/u);
  assert.match(asset, /isstruct\(interaction_state\) \|\| ~isfield\(interaction_state, 'SelectedObservationIDs'\)/u);
  assert.match(asset, /R2023a or newer/u);
  assert.match(asset, /safe_data_cursor_update/u);
  assert.match(asset, /event\.Target/u);
  assert.match(asset, /event\.DataIndex/u);
  assert.match(asset, /CloseRequestFcn = @close_interactive_figure/u);
  assert.match(asset, /UpdateFcn = \[\]/u);
  assert.match(asset, /ActionPostCallback = \[\]/u);
  assert.match(asset, /is_live_handle/u);
  assert.match(asset, /isequal\(interaction_state\.LinkDataEnabled, true\)/u);
  assert.match(asset, /isequal\(interaction_state\.UsesAxesInteractionModes, true\)/u);
  assert.match(asset, /rmappdata/u);
  assert.match(asset, /'DataCursorUpdateFcn', @safe_data_cursor_update/u);
  assert.match(asset, /'GetSelectedObservationIdentity', @\(\) collect_selected_identity/u);
  assert.match(asset, /OceanCallerOwnsFigure[\s\S]*clear figure_cleanup/u);
});

test('interactive MATLAB asset separates desktop and headless exports', () => {
  assert.match(asset, /usejava\('desktop'\)/u);
  assert.match(asset, /HeadlessFallback/u);
  assert.match(asset, /ExportMode/u);
  assert.match(asset, /options\.Export/u);
  assert.match(asset, /oi_export_figure\(figure_handle/u);
  assert.match(asset, /exportapp\(figure_handle, png_path/u);
  assert.match(asset, /exportapp\(figure_handle, pdf_path/u);
  assert.match(exportHelper, /exportgraphics\(figureHandle, pngPath/u);
  assert.match(exportHelper, /exportgraphics\(figureHandle, pdfPath/u);
  assert.match(asset, /exportapp requires MATLAB R2020b/u);
  assert.match(asset, /ExportMode="graphics" requires UseUIFigure=false/u);
  assert.match(asset, /exportapp_interface_snapshot_not_supported_by_publication_manifest/u);
  assert.match(asset, /'ManifestAvailable', manifest_available/u);
  assert.match(asset, /'ManifestReason', manifest_reason/u);
  assert.match(asset, /'ExportAPI', export_api/u);
  assert.match(asset, /'RuntimeRelease', string\(version\('-release'\)\)/u);
  assert.match(asset, /'RequiredProducts', "MATLAB"/u);
  assert.match(asset, /'RequiredToolboxes', options\.RequiredToolboxes\(:\)/u);
  assert.match(asset, /'verified', logical\(~desktop_available && options\.Export\)/u);
});

test('interactive MATLAB asset keeps publication and CJK styling explicit', () => {
  assert.match(asset, /options\.FontName/u);
  assert.match(asset, /resolve_interaction_font/u);
  assert.match(asset, /string\(listfonts\)/u);
  assert.match(asset, /CJKFontUnavailable/u);
  assert.match(asset, /Padding', 'loose'/u);
  assert.match(asset, /'MarkerFaceColor', theme\.CanvasColor/u);
  assert.match(asset, /'s--'/u);
  assert.match(asset, /'ExportTarget', export_target/u);
  assert.match(asset, /'ExportPerformed', options\.Export/u);
  assert.match(asset, /'PublicationExport', options\.Export && export_target == "plot"/u);
  assert.match(asset, /'FontRenderingVerified', false/u);
  assert.doesNotMatch(asset, /FontName = 'Helvetica'/u);
});

test('interaction reference constrains linkdata and static delivery', () => {
  assert.match(reference, /linkaxes/u);
  assert.match(reference, /taskType="interactive"/u);
  assert.match(reference, /实际调用 `interactive_timeseries_native_template\.m`/u);
  assert.match(reference, /模板默认不启用 `linkdata`/u);
  assert.match(reference, /linkdata\(fig, "off"\)/u);
  assert.match(reference, /稳定 ID/u);
  assert.match(reference, /pinned data tip/u);
  assert.match(reference, /不能声称渲染或交互已验证/u);
  assert.match(reference, /CJK/u);
  assert.match(reference, /界面快照/u);
  assert.match(reference, /颜色与线型\/marker/u);
});

test('real MATLAB acceptance covers identity, callbacks, cleanup and headless fallback', () => {
  assert.match(acceptance, /mustBeMember\(mode, \["desktop", "headless"\]\)/u);
  assert.match(acceptance, /SourceRow/u);
  assert.match(acceptance, /sortrows\(data, 'Time'\)/u);
  assert.match(acceptance, /DataCursorUpdateFcn/u);
  assert.match(acceptance, /GetSelectedObservationIdentity/u);
  assert.match(acceptance, /desktop_callback_reentry/u);
  assert.match(acceptance, /close_lifecycle_cleanup/u);
  assert.match(acceptance, /verify_exception_cleanup/u);
  assert.match(acceptance, /HeadlessFallbackUsed/u);
  assert.match(acceptance, /oi_sha256_file/u);
  assert.doesNotMatch(acceptance, /octave/iu);
});

test('evidence validator verifies real files, bytes and hashes', () => {
  assert.match(evidenceValidator, /createHash\('sha256'\)/u);
  assert.match(evidenceValidator, /stat\.size/u);
  assert.match(evidenceValidator, /artifact\.bytes/u);
  assert.match(evidenceValidator, /artifact\.sha256/u);
  assert.match(evidenceValidator, /evidence\.status, 'passed'/u);
  assert.match(evidenceValidator, /visual_inspection\.required/u);
});
