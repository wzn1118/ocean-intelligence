function evidence = run_interaction_acceptance(output_directory)
%RUN_INTERACTION_ACCEPTANCE Validate cross-release interaction contracts.
arguments
  output_directory (1,1) string
end

audit_directory = fileparts(mfilename('fullpath'));
repository_root = fileparts(fileparts(fileparts(audit_directory)));
addpath(fullfile(repository_root, 'codex-runtime', 'matlab', 'assets'));
assert(strlength(strtrim(output_directory)) > 0 && isfolder(output_directory), ...
  'A pre-existing output directory is required');

evidence_path = fullfile(output_directory, 'interaction-evidence.json');
assert(~isfile(evidence_path), 'Acceptance requires a fresh evidence path');
evidence = base_evidence();

try
  time = datetime(2026, 9, 5, 0, 0, 0, 'TimeZone', 'UTC') + hours(0:2)';
  value = [24.5; 24.8; 25.1];
  secondary_value = [34.9; 35.0; 35.1];
  observation_id = ["obs-single"; "obs-middle"; "obs-last"];
  station = ["S01"; "S01"; "S02"];
  qc_flag = ["good"; "suspect"; "good"];
  source_row = [7; 11; 19];
  data = table(time, value, secondary_value, observation_id, station, qc_flag, ...
    source_row, 'VariableNames', {'Time', 'Value', 'SecondaryValue', ...
      'ObservationID', 'Station', 'QCFlag', 'SourceRow'});
  data.Properties.VariableUnits = {'', 'degC', 'psu', '', '', '', ''};

  installed_fonts = string(listfonts);
  assert(~isempty(installed_fonts), 'MATLAB reported no installed fonts');
  output_stem = fullfile(output_directory, 'interaction-contract');
  outputs = interactive_timeseries_native_template(data, output_stem, ...
    'Interactive', true, 'UseUIFigure', false, ...
    'UseDataCursorCallback', true, 'Export', false, ...
    'Title', "Cross-release interaction acceptance", ...
    'FontName', installed_fonts(1), 'TimeZone', "UTC", ...
    'ValueLabel', "Temperature", 'ValueUnit', "degC", ...
    'SecondaryValueLabel', "Salinity", 'SecondaryValueUnit', "psu");
  figure_cleanup = onCleanup(@() close_if_valid(outputs.Figure));

  expected_mode = "aligned-metadata";
  expected_template_rows = 6;
  if verLessThan('matlab', '9.11')
    expected_mode = "property-only";
    expected_template_rows = 2;
  end
  assert(outputs.DataTipTemplateMode == expected_mode, ...
    'Unexpected release-specific DataTipTemplate mode');
  assert(numel(outputs.Lines(1).DataTipTemplate.DataTipRows) == expected_template_rows, ...
    'DataTipTemplate rows do not match the release capability branch');
  evidence.checks(end + 1) = passed_check("release_datatip_template");

  tip_rows = outputs.DataCursorUpdateFcn([], ...
    struct('Target', outputs.Lines(1), 'DataIndex', 1));
  assert(iscell(tip_rows) && numel(tip_rows) == 5 ...
    && all(cellfun(@ischar, tip_rows)), ...
    'Data cursor callback must return five character rows');
  assert(contains(string(tip_rows{1}), "obs-single") ...
    && contains(string(tip_rows{1}), "Source row: 7") ...
    && contains(string(tip_rows{2}), "S01") ...
    && contains(string(tip_rows{3}), "good") ...
    && startsWith(string(tip_rows{4}), "Time: ") ...
    && contains(string(tip_rows{5}), "Temperature (degC)"), ...
    'Data cursor callback fields are missing, reordered, or misaligned');
  evidence.checks(end + 1) = passed_check("callback_five_row_alignment");

  outputs.Lines(1).BrushData = [1 0 1];
  selected = outputs.GetSelectedObservationIdentity();
  assert(isequal(selected.ObservationID, observation_id([1 3])) ...
    && isequal(selected.SourceRow, source_row([1 3])), ...
    'Brush selection did not preserve stable observation identity');
  evidence.checks(end + 1) = passed_check("brush_identity_mapping");

  xlim(outputs.Axes(1), [time(1) time(2)]);
  drawnow;
  assert(isequal(outputs.Axes(1).XLim, outputs.Axes(2).XLim), ...
    'linkaxes did not synchronize coordinated time axes');
  evidence.checks(end + 1) = passed_check("linked_time_axes");

  close(outputs.Figure);
  assert(~isgraphics(outputs.Figure) ...
    && isempty(outputs.GetSelectedObservationIDs()) ...
    && isequal(outputs.DataCursorUpdateFcn([], ...
      struct('Target', outputs.Lines(1), 'DataIndex', 1)), ...
      {'Data tip unavailable'}), ...
    'Callback cleanup was unsafe after figure deletion');
  evidence.checks(end + 1) = passed_check("callback_cleanup");
  evidence.status = "passed";
  clear figure_cleanup;
catch acceptance_error
  evidence.status = "failed";
  evidence.error = struct('identifier', string(acceptance_error.identifier), ...
    'message', string(acceptance_error.message));
  write_json(evidence_path, evidence);
  rethrow(acceptance_error);
end

write_json(evidence_path, evidence);
end

function evidence = base_evidence()
evidence = struct('schema_version', "1.0", 'scope', "interaction", ...
  'status', "running", ...
  'generated_at', string(datetime('now', 'TimeZone', 'UTC', ...
    'Format', 'yyyy-MM-dd''T''HH:mm:ssXXX')), ...
  'matlab_release', string(version('-release')), ...
  'matlab_version', string(version), ...
  'desktop_available', logical(usejava('desktop')), ...
  'checks', struct('name', {}, 'status', {}), ...
  'error', struct('identifier', "", 'message', ""));
end

function check = passed_check(name)
check = struct('name', name, 'status', "passed");
end

function write_json(file_path, value)
file_id = fopen(file_path, 'w');
assert(file_id >= 0, 'Unable to open interaction evidence JSON');
file_cleanup = onCleanup(@() fclose(file_id));
fwrite(file_id, jsonencode(value), 'char');
clear file_cleanup;
end

function close_if_valid(figure_handle)
if isgraphics(figure_handle)
  close(figure_handle);
end
end
