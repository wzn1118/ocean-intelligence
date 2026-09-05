function evidence = run_interaction_acceptance(mode, output_directory)
%RUN_INTERACTION_ACCEPTANCE Exercise real MATLAB interaction and cleanup paths.
arguments
  mode (1,1) string {mustBeMember(mode, ["desktop", "headless"])}
  output_directory (1,1) string
end

audit_directory = fileparts(mfilename('fullpath'));
repository_root = fileparts(fileparts(fileparts(fileparts(audit_directory))));
addpath(fullfile(repository_root, 'codex-runtime', 'matlab', 'assets'));
assert(strlength(strtrim(output_directory)) > 0, 'Output directory is required');
assert(isfolder(output_directory), 'Output directory must already exist');

desktop_available = usejava('desktop');
if mode == "desktop"
  assert(desktop_available, 'Desktop acceptance requires usejava(''desktop'') == true');
else
  assert(~desktop_available, 'Headless acceptance requires usejava(''desktop'') == false');
end

artifact_stem = fullfile(output_directory, mode + "-interaction");
png_path = artifact_stem + ".png";
pdf_path = artifact_stem + ".pdf";
evidence_path = fullfile(output_directory, mode + "-interaction-evidence.json");
assert(~isfile(png_path) && ~isfile(pdf_path) && ~isfile(evidence_path), ...
  'Acceptance requires a fresh output directory');

evidence = base_evidence(mode, desktop_available);
try
  data = filtered_sorted_fixture();
  expected_ids = data.ObservationID;
  expected_source_rows = data.SourceRow;
  installed_fonts = string(listfonts);
  assert(~isempty(installed_fonts), 'MATLAB reported no installed fonts');

  outputs = interactive_timeseries_native_template(data, artifact_stem, ...
    'Interactive', true, 'UseUIFigure', false, ...
    'UseDataCursorCallback', true, 'ExportMode', "graphics", ...
    'Export', true, 'Title', "Interaction acceptance", ...
    'FontName', installed_fonts(1), 'TimeZone', "UTC", ...
    'ValueLabel', "Temperature", 'ValueUnit', "degC");

  assert(isequal(outputs.Lines(1).UserData.ObservationID(:), expected_ids(:)), ...
    'Rendered ObservationID order changed after filtering and sorting');
  assert(isequal(outputs.Lines(1).UserData.SourceRow(:), expected_source_rows(:)), ...
    'Rendered SourceRow mapping changed after filtering and sorting');
  evidence.checks(end + 1) = passed_check("sorted_identity_mapping");

  if mode == "desktop"
    assert(outputs.InteractiveEnabled && ~outputs.HeadlessFallbackUsed, ...
      'Desktop interaction was not enabled');
    tip_rows = outputs.DataCursorUpdateFcn([], ...
      struct('Target', outputs.Lines(1), 'DataIndex', 2));
    assert(any(contains(string(tip_rows), expected_ids(2))), ...
      'DataTip callback did not return the stable ObservationID');
    assert(any(contains(string(tip_rows), "Source row: " + expected_source_rows(2))), ...
      'DataTip callback did not return the pre-filter SourceRow');
    evidence.checks(end + 1) = passed_check("desktop_datatip_identity");

    outputs.Lines(1).BrushData = [1 0 1 0];
    selected_identity = outputs.GetSelectedObservationIdentity();
    assert(isequal(selected_identity.ObservationID, expected_ids([1 3])), ...
      'Brush returned incorrect stable ObservationID values');
    assert(isequal(selected_identity.SourceRow, expected_source_rows([1 3])), ...
      'Brush returned incorrect SourceRow values');
    selected_again = outputs.GetSelectedObservationIdentity();
    assert(isequal(selected_again, selected_identity), ...
      'Repeated brush callback collection was not stable');
    evidence.checks(end + 1) = passed_check("desktop_brush_identity");
    evidence.checks(end + 1) = passed_check("desktop_callback_reentry");
  else
    assert(~outputs.InteractiveEnabled && outputs.HeadlessFallbackUsed, ...
      'Headless run did not use the static fallback');
    assert(outputs.ExportTarget == "plot" && outputs.PublicationExport, ...
      'Headless run did not use the publication graphics path');
    evidence.checks(end + 1) = passed_check("headless_static_fallback");
  end

  line_handle = outputs.Lines(1);
  close(outputs.Figure);
  assert(~isgraphics(outputs.Figure), 'CloseRequestFcn did not delete the figure');
  assert(isempty(outputs.GetSelectedObservationIDs()), ...
    'Selection getter was not safe after figure deletion');
  unavailable_rows = outputs.DataCursorUpdateFcn([], ...
    struct('Target', line_handle, 'DataIndex', 1));
  assert(isequal(unavailable_rows, {'Data tip unavailable'}), ...
    'DataTip callback was not safe after graphics deletion');
  evidence.checks(end + 1) = passed_check("close_lifecycle_cleanup");

  verify_exception_cleanup(data, output_directory, installed_fonts(1));
  evidence.checks(end + 1) = passed_check("exception_cleanup");

  evidence.artifacts = [artifact_record(png_path, "png"), ...
    artifact_record(pdf_path, "pdf")];
  evidence.status = "passed";
catch acceptance_error
  evidence.status = "failed";
  evidence.error = struct('identifier', string(acceptance_error.identifier), ...
    'message', string(acceptance_error.message));
  write_json(evidence_path, evidence);
  rethrow(acceptance_error);
end
write_json(evidence_path, evidence);
end

function data = filtered_sorted_fixture()
time = datetime(2026, 9, 5, [4 1 3 2 6 5], 0, 0, 'TimeZone', 'UTC')';
value = [24.1 20.2 23.0 21.4 25.3 24.8]';
observation_id = ["OBS-004" "OBS-001" "OBS-003" "OBS-002" "OBS-006" "OBS-005"]';
station = repmat("STATION-A", 6, 1);
qc_flag = ["good" "good" "suspect" "good" "rejected" "good"]';
source_row = (1:6)';
data = table(time, value, observation_id, station, qc_flag, source_row, ...
  'VariableNames', {'Time', 'Value', 'ObservationID', 'Station', 'QCFlag', 'SourceRow'});
data.Properties.VariableUnits = {'', 'degC', '', '', '', ''};
data = data(data.QCFlag ~= "rejected" & data.ObservationID ~= "OBS-003", :);
data = sortrows(data, 'Time');
end

function verify_exception_cleanup(data, output_directory, font_name)
before = findall(groot, 'Type', 'figure');
stale_stem = fullfile(output_directory, "expected-stale-export");
stale_png = stale_stem + ".png";
stale_pdf = stale_stem + ".pdf";
cleanup_files = onCleanup(@() delete_if_present([stale_png stale_pdf]));
write_bytes(stale_png, uint8(1));
write_bytes(stale_pdf, uint8(1));
threw = false;
try
  interactive_timeseries_native_template(data, stale_stem, ...
    'Interactive', false, 'Export', true, 'Title', "Expected failure", ...
    'FontName', font_name, 'TimeZone', "UTC", ...
    'ValueLabel', "Temperature", 'ValueUnit', "degC");
catch expected_error
  threw = contains(string(expected_error.message), ...
    "Refusing to overwrite an existing interactive export");
end
assert(threw, 'Expected stale-export exception was not observed');
drawnow;
after = findall(groot, 'Type', 'figure');
assert(numel(after) == numel(before), ...
  'Exceptional construction left a residual figure');
clear cleanup_files;
end

function evidence = base_evidence(mode, desktop_available)
evidence = struct('schema_version', "1.0", ...
  'scope', "interaction", 'mode', mode, 'status', "running", ...
  'generated_at', string(datetime('now', 'TimeZone', 'UTC', ...
    'Format', 'yyyy-MM-dd''T''HH:mm:ssXXX')), ...
  'matlab_release', string(version('-release')), ...
  'matlab_version', string(version), ...
  'desktop_available', logical(desktop_available), ...
  'checks', struct('name', {}, 'status', {}), ...
  'artifacts', struct('kind', {}, 'file', {}, 'bytes', {}, 'sha256', {}), ...
  'visual_inspection', struct('status', "pending", ...
    'required', true, 'reviewer', "", 'notes', ""), ...
  'error', struct('identifier', "", 'message', ""));
end

function check = passed_check(name)
check = struct('name', name, 'status', "passed");
end

function artifact = artifact_record(file_path, kind)
file_info = dir(file_path);
assert(isfile(file_path) && file_info.bytes > 0, kind + " artifact is missing or empty");
artifact = struct('kind', kind, 'file', string(file_info.name), ...
  'bytes', file_info.bytes, 'sha256', string(oi_sha256_file(file_path)));
end

function write_json(file_path, value)
file_id = fopen(file_path, 'w');
assert(file_id >= 0, 'Unable to open evidence JSON for writing');
file_cleanup = onCleanup(@() fclose(file_id));
fwrite(file_id, jsonencode(value), 'char');
clear file_cleanup;
end

function write_bytes(file_path, bytes)
file_id = fopen(file_path, 'w');
assert(file_id >= 0, 'Unable to create expected stale artifact');
file_cleanup = onCleanup(@() fclose(file_id));
fwrite(file_id, bytes, 'uint8');
clear file_cleanup;
end

function delete_if_present(paths)
for path_index = 1:numel(paths)
  if isfile(paths(path_index))
    delete(paths(path_index));
  end
end
end
