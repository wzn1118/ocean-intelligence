function outputs = interactive_timeseries_native_template(data, output_base, options)
%INTERACTIVE_TIMESERIES_NATIVE_TEMPLATE Interactive MATLAB figure with deterministic export.
arguments
  data table
  output_base (1,1) string
  options.Interactive (1,1) logical = usejava('desktop')
  options.UseUIFigure (1,1) logical = false
  options.UseDataCursorCallback (1,1) logical = false
  options.ExportMode (1,1) string {mustBeMember(options.ExportMode, ["auto", "graphics", "app"])} = "auto"
  options.Export (1,1) logical = true
  options.ExportSVG (1,1) logical = false
  options.RequiredToolboxes (1,:) string = strings(1, 0)
  options.Title (1,1) string = "Interactive time series"
  options.FontName (1,1) string = ""
  options.TimeZone (1,1) string = ""
  options.ValueLabel (1,1) string = ""
  options.ValueUnit (1,1) string = ""
  options.UncertaintyType (1,1) string = ""
  options.UncertaintyUnit (1,1) string = ""
  options.ConfidenceLevel (1,1) double = NaN
  options.SecondaryValueLabel (1,1) string = ""
  options.SecondaryValueUnit (1,1) string = ""
  options.PublicationWidthPixels (1,1) double {mustBeInteger,mustBePositive} = 2400
  options.PublicationHeightPixels (1,1) double {mustBeInteger,mustBePositive} = 1500
  options.PublicationDPI (1,1) double {mustBeInteger,mustBePositive} = 300
end

assert(~ismissing(output_base) && strlength(strtrim(output_base)) > 0, ...
  'output_base must not be empty');
[output_directory, figure_id, extension] = fileparts(char(output_base));
assert(isempty(extension), 'output_base must be a file stem without an extension');
assert(~isempty(figure_id) ...
  && ~isempty(regexp(figure_id, '^[A-Za-z0-9][A-Za-z0-9._-]*$', 'once')) ...
  && ~contains(figure_id, '..'), ...
  'output_base must end in a safe nonempty file stem');
if isempty(output_directory)
  output_directory = pwd;
end
assert(isfolder(output_directory), 'The output folder must already exist');
output_directory = string(output_directory);
figure_id = string(figure_id);
title_text = oi_require_text(options.Title, ...
  "interactive_timeseries_native_template:Title", ...
  "Title must be explicit nonblank text");

required_names = ["Time", "Value", "ObservationID", "Station", "QCFlag"];
assert(all(ismember(required_names, string(data.Properties.VariableNames))), ...
  'data must contain Time, Value, ObservationID, Station, and QCFlag');
assert(height(data) > 0, 'data must contain at least one observation');
time = data.Time(:);
value = data.Value(:);
station_values = data.Station(:);
qc_values = data.QCFlag(:);
observation_ids = strtrim(string(data.ObservationID(:)));
station_text = strtrim(string(station_values));
qc_text = strtrim(string(qc_values));
assert(isdatetime(time) && ~isempty(time.TimeZone) && all(~isnat(time)), ...
  'Time must contain timezone-aware datetime values without NaT');
assert(numel(time) == height(data) && all(diff(time) > seconds(0)), ...
  'Time must be unique and strictly increasing');
declared_time_zone = strtrim(options.TimeZone);
assert(strlength(declared_time_zone) == 0 ...
  || declared_time_zone == string(time.TimeZone), ...
  'Time.TimeZone must match the explicitly declared TimeZone');
assert(isnumeric(value) && isreal(value) && isvector(value), ...
  'Value must be a real numeric vector');
assert(numel(value) == height(data) && ~any(isinf(value), 'all'), ...
  'Value must align with data and may contain NaN but not Inf');
assert(any(isfinite(value)), 'Value must contain at least one finite sample');
value_label = strtrim(options.ValueLabel);
value_unit = strtrim(options.ValueUnit);
assert(strlength(value_label) > 0 && strlength(value_unit) > 0, ...
  'ValueLabel and ValueUnit must be explicitly supplied');
assert_table_unit(data, "Value", value_unit);
assert(all(~ismissing(data.ObservationID(:))) ...
  && all(~ismissing(observation_ids)) && all(strlength(observation_ids) > 0), ...
  'ObservationID must contain nonmissing stable identifiers');
assert(isvector(observation_ids) && numel(observation_ids) == height(data) ...
  && isvector(station_values) && numel(station_values) == height(data) ...
  && isvector(qc_values) && numel(qc_values) == height(data), ...
  'ObservationID, Station, and QCFlag must contain one value per row');
assert(all(~ismissing(station_values)) && all(~ismissing(qc_values)), ...
  'Station and QCFlag must be nonmissing for every observation');
assert(all(strlength(station_text) > 0) && all(strlength(qc_text) > 0), ...
  'Station and QCFlag must be nonempty after trimming');
qc_categories = unique(qc_text, 'stable');
qc_counts = zeros(numel(qc_categories), 1);
for qc_index = 1:numel(qc_categories)
  qc_counts(qc_index) = sum(qc_text == qc_categories(qc_index));
end
qc_summary = table(qc_categories, qc_counts, ...
  'VariableNames', {'Flag', 'Count'});
assert(numel(unique(observation_ids)) == height(data), ...
  'ObservationID values must be unique after filtering and ordering');
if ismember("SourceRow", string(data.Properties.VariableNames))
  source_rows = data.SourceRow(:);
  assert(isnumeric(source_rows) && isreal(source_rows) && isvector(source_rows) ...
    && numel(source_rows) == height(data) && all(isfinite(source_rows)) ...
    && all(source_rows == fix(source_rows)) && all(source_rows >= 1) ...
    && numel(unique(source_rows)) == height(data), ...
    'SourceRow must contain unique positive integer source positions after filtering and ordering');
  source_row_origin = "supplied_pre_filter_identity";
else
  source_rows = (1:height(data))';
  source_row_origin = "call_entry_order";
end

variable_names = string(data.Properties.VariableNames);
has_uncertainty = ismember("Uncertainty", variable_names);
has_lower_bound = ismember("UncertaintyLower", variable_names);
has_upper_bound = ismember("UncertaintyUpper", variable_names);
assert(has_lower_bound == has_upper_bound, ...
  'UncertaintyLower and UncertaintyUpper must be supplied together');
assert(~(has_uncertainty && has_lower_bound), ...
  'Supply uncertainty magnitude or lower/upper bounds, not both');
uncertainty_representation = "none";
uncertainty_values = nan(height(data), 1);
uncertainty_lower = nan(height(data), 1);
uncertainty_upper = nan(height(data), 1);
uncertainty_type = replace(strtrim(options.UncertaintyType), "_", "-");
uncertainty_unit = strtrim(options.UncertaintyUnit);
valid_mask = isfinite(value);
if has_uncertainty || has_lower_bound
  assert(strlength(uncertainty_type) > 0 && strlength(uncertainty_unit) > 0, ...
    'UncertaintyType and UncertaintyUnit must be supplied with uncertainty data');
  allowed_uncertainty_types = ["standard-uncertainty" "standard-deviation" "standard-error" ...
    "confidence-interval" "instrument-accuracy" "ensemble-spread"];
  assert(any(uncertainty_type == allowed_uncertainty_types), ...
    'UncertaintyType is not a supported scientific uncertainty semantic');
  assert(uncertainty_unit == value_unit, ...
    'UncertaintyUnit must match ValueUnit unless the caller performs an explicit conversion');
  if uncertainty_type == "confidence-interval"
    assert(isreal(options.ConfidenceLevel) && isfinite(options.ConfidenceLevel) ...
      && options.ConfidenceLevel > 0 ...
      && options.ConfidenceLevel < 1, ...
      'ConfidenceLevel must be an explicit fraction between zero and one');
  else
    assert(isnan(options.ConfidenceLevel), ...
      'ConfidenceLevel applies only to confidence-interval uncertainty');
  end
else
  assert(strlength(uncertainty_type) == 0 && strlength(uncertainty_unit) == 0 ...
    && isnan(options.ConfidenceLevel), ...
    'Uncertainty metadata must be omitted when uncertainty data are absent');
end
if has_uncertainty
  uncertainty_representation = "magnitude";
  uncertainty_values = data.Uncertainty(:);
  assert(isnumeric(uncertainty_values) && isreal(uncertainty_values) ...
    && numel(uncertainty_values) == height(data), ...
    'Uncertainty must be a real numeric vector aligned with Value');
  assert(all(isnan(uncertainty_values) ...
    | (isfinite(uncertainty_values) & uncertainty_values >= 0)), ...
    'Uncertainty must contain nonnegative finite magnitudes or NaN');
  assert(~any(isfinite(uncertainty_values) & ~isfinite(value)), ...
    'Finite uncertainty cannot exist where Value is missing');
  assert_table_unit(data, "Uncertainty", uncertainty_unit);
  valid_mask = valid_mask & isfinite(uncertainty_values);
elseif has_lower_bound
  uncertainty_representation = "bounds";
  uncertainty_lower = data.UncertaintyLower(:);
  uncertainty_upper = data.UncertaintyUpper(:);
  assert(isnumeric(uncertainty_lower) && isreal(uncertainty_lower) ...
    && isnumeric(uncertainty_upper) && isreal(uncertainty_upper) ...
    && numel(uncertainty_lower) == height(data) ...
    && numel(uncertainty_upper) == height(data), ...
    'Uncertainty bounds must be real numeric vectors aligned with Value');
  assert(~any(isinf(uncertainty_lower), 'all') ...
    && ~any(isinf(uncertainty_upper), 'all'), ...
    'Uncertainty bounds may contain NaN but not Inf');
  assert(isequal(isfinite(uncertainty_lower), isfinite(uncertainty_upper)), ...
    'Uncertainty lower/upper bounds must have identical finite/NaN masks');
  assert(uncertainty_type == "confidence-interval", ...
    'Uncertainty bounds require UncertaintyType="confidence-interval"');
  assert_table_unit(data, "UncertaintyLower", uncertainty_unit);
  assert_table_unit(data, "UncertaintyUpper", uncertainty_unit);
  complete_bounds = isfinite(value) & isfinite(uncertainty_lower) ...
    & isfinite(uncertainty_upper);
  assert(~any(isfinite(uncertainty_lower) & ~isfinite(value)), ...
    'Finite uncertainty bounds cannot exist where Value is missing');
  assert(all(uncertainty_lower(complete_bounds) <= value(complete_bounds)) ...
    && all(value(complete_bounds) <= uncertainty_upper(complete_bounds)), ...
    'Uncertainty bounds must enclose every complete Value');
  valid_mask = complete_bounds;
end
if has_uncertainty || has_lower_bound
  assert(any(valid_mask), 'Uncertainty data must contain at least one complete sample');
end
has_secondary = ismember("SecondaryValue", string(data.Properties.VariableNames));
secondary_value = nan(height(data), 1);
secondary_label = strtrim(options.SecondaryValueLabel);
secondary_unit = strtrim(options.SecondaryValueUnit);
if has_secondary
  secondary_value = data.SecondaryValue(:);
  assert(isnumeric(secondary_value) && isreal(secondary_value) && isvector(secondary_value), ...
    'SecondaryValue must be a real numeric vector');
  assert(numel(secondary_value) == height(data) && ~any(isinf(secondary_value), 'all'), ...
    'SecondaryValue must align with data and may contain NaN but not Inf');
  assert(any(isfinite(secondary_value)), ...
    'SecondaryValue must contain at least one finite sample');
  assert(~ismissing(secondary_label) && ~ismissing(secondary_unit) ...
    && strlength(secondary_label) > 0 && strlength(secondary_unit) > 0, ...
    'SecondaryValueLabel and SecondaryValueUnit must be explicitly supplied');
  assert_table_unit(data, "SecondaryValue", secondary_unit);
else
  assert(~ismissing(secondary_label) && ~ismissing(secondary_unit) ...
    && strlength(secondary_label) == 0 && strlength(secondary_unit) == 0, ...
    'SecondaryValue metadata must be omitted when SecondaryValue data are absent');
end
assert(~verLessThan('matlab', '9.7'), ...
  'DataTipTemplate requires MATLAB R2019b or newer');

theme = oi_ocean_theme();
font_text = [title_text; value_label; value_unit; options.SecondaryValueLabel; ...
  options.SecondaryValueUnit; observation_ids; station_text; qc_text];
[font_name, cjk_text_present] = resolve_interaction_font( ...
  options.FontName, theme.FontName, font_text);

desktop_available = usejava('desktop');
interactive_enabled = options.Interactive && desktop_available;
if options.Interactive && ~desktop_available
  warning('ocean:interaction:HeadlessFallback', ...
    'MATLAB desktop is unavailable; interaction is disabled and static graphics export is used.');
end
ui_figure_enabled = options.UseUIFigure && interactive_enabled;
if options.UseUIFigure && ~ui_figure_enabled
  warning('ocean:interaction:UIFigureFallback', ...
    'uifigure was requested without a desktop; using a traditional invisible figure.');
end
if options.ExportMode == "app"
  assert(ui_figure_enabled, ...
    'ExportMode="app" requires an interactive uifigure desktop path');
  assert(~verLessThan('matlab', '9.9'), ...
    'exportapp requires MATLAB R2020b or newer');
end
if ui_figure_enabled
  assert(~verLessThan('matlab', '9.14'), ...
    'uiaxes-targeted datacursormode and brush require MATLAB R2023a or newer');
  assert(~options.Export || options.ExportMode ~= "graphics", ...
    'ExportMode="graphics" requires UseUIFigure=false; use ExportMode="app" for a uifigure interface snapshot');
end

visible = 'off';
if interactive_enabled
  visible = 'on';
end
if ui_figure_enabled
  figure_handle = uifigure('Color', theme.CanvasColor, 'Position', [80 80 1200 720], ...
    'Visible', visible);
else
  publication_size = [options.PublicationWidthPixels options.PublicationHeightPixels] ...
    / options.PublicationDPI;
  figure_handle = figure('Color', theme.CanvasColor, 'Units', 'inches', ...
    'Position', [1 1 publication_size], 'Visible', visible, ...
    'PaperUnits', 'inches', 'PaperPosition', [0 0 publication_size], ...
    'PaperSize', publication_size, 'PaperPositionMode', 'manual');
end
figure_cleanup = onCleanup(@() close_unowned_figure(figure_handle));
figure_handle.CloseRequestFcn = @close_interactive_figure;

panel_count = 1 + has_secondary;
layout = tiledlayout(figure_handle, panel_count, 1, ...
  'TileSpacing', 'compact', 'Padding', 'loose');
if ~ui_figure_enabled
  page_margin = min(0.25 ./ publication_size, 0.1);
  layout.Units = 'normalized';
  layout.PositionConstraint = 'outerposition';
  layout.OuterPosition = [page_margin 1 - 2 * page_margin];
end
axes_handles = gobjects(panel_count, 1);
line_handles = gobjects(panel_count, 1);
uncertainty_handles = gobjects(panel_count, 1);

point_metadata = struct('Time', time, 'ObservationID', observation_ids, ...
  'Station', station_text, 'QCFlag', qc_text, ...
  'SourceRow', source_rows, 'SourceRowOrigin', source_row_origin, ...
  'UncertaintyRepresentation', uncertainty_representation, ...
  'UncertaintyType', uncertainty_type, 'UncertaintyUnit', uncertainty_unit, ...
  'Uncertainty', uncertainty_values, ...
  'UncertaintyLower', uncertainty_lower, 'UncertaintyUpper', uncertainty_upper);
data_tip_template_mode = resolve_data_tip_template_mode();

axes_handles(1) = nexttile(layout);
if uncertainty_representation == "magnitude"
  uncertainty_handles(1) = errorbar(axes_handles(1), time, value, ...
    uncertainty_values, 'LineStyle', 'none', 'Color', [0.25 0.25 0.25], ...
    'LineWidth', 1.0, 'CapSize', 5, 'HitTest', 'off', 'PickableParts', 'none');
  hold(axes_handles(1), 'on');
elseif uncertainty_representation == "bounds"
  uncertainty_handles(1) = errorbar(axes_handles(1), time, value, ...
    value - uncertainty_lower, uncertainty_upper - value, ...
    'LineStyle', 'none', 'Color', [0.25 0.25 0.25], ...
    'LineWidth', 1.0, 'CapSize', 5, 'HitTest', 'off', 'PickableParts', 'none');
  hold(axes_handles(1), 'on');
end
line_handles(1) = plot(axes_handles(1), time, value, 'o-', ...
  'LineWidth', 1.3, 'MarkerSize', 4, 'Color', theme.LineColors(1, :), ...
  'MarkerFaceColor', theme.CanvasColor, 'DisplayName', 'Value');
if uncertainty_representation ~= "none"
  hold(axes_handles(1), 'off');
end
configure_series(axes_handles(1), line_handles(1), point_metadata, value, ...
  value_label, value_unit, theme, font_name, data_tip_template_mode);
if has_secondary
  axes_handles(2) = nexttile(layout);
  line_handles(2) = plot(axes_handles(2), data.Time, secondary_value, 's--', ...
    'LineWidth', 1.3, 'MarkerSize', 4, 'Color', theme.LineColors(2, :), ...
    'MarkerFaceColor', theme.CanvasColor, 'DisplayName', 'SecondaryValue');
  secondary_metadata = point_metadata;
  secondary_metadata.UncertaintyRepresentation = "none";
  configure_series(axes_handles(2), line_handles(2), secondary_metadata, ...
    secondary_value, secondary_label, secondary_unit, theme, font_name, ...
    data_tip_template_mode);
  linkaxes(axes_handles, 'x');
end
title(layout, title_text, 'FontWeight', 'normal', 'Interpreter', 'none', ...
  'FontName', font_name, 'FontSize', theme.TitleSize, 'Color', theme.TextColor);

interaction_state = struct('SelectedObservationIDs', strings(0, 1), ...
  'SelectedSourceRows', zeros(0, 1), ...
  'BrushMode', [], 'DataCursorMode', [], ...
  'BrushModes', {cell(panel_count, 1)}, 'DataCursorModes', {cell(panel_count, 1)}, ...
  'Axes', axes_handles, ...
  'UsesAxesInteractionModes', ui_figure_enabled, 'LinkDataEnabled', false);
setappdata(figure_handle, 'OceanInteractionState', interaction_state);
if interactive_enabled
  if ui_figure_enabled
    assert(~options.UseDataCursorCallback, ...
      'Custom datacursormode callbacks are limited to traditional figures in this template');
    for axes_index = 1:numel(axes_handles)
      datacursormode(axes_handles(axes_index), 'on');
      brush(axes_handles(axes_index), 'on');
    end
  else
    data_cursor_mode = datacursormode(figure_handle);
    data_cursor_mode.Enable = 'on';
    if options.UseDataCursorCallback
      data_cursor_mode.UpdateFcn = @safe_data_cursor_update;
    end
    brush_mode = brush(figure_handle);
    brush_mode.Enable = 'on';
    brush_mode.ActionPostCallback = @(~, ~) capture_brushed_ids(figure_handle, line_handles);
    interaction_state = getappdata(figure_handle, 'OceanInteractionState');
    interaction_state.BrushMode = brush_mode;
    interaction_state.DataCursorMode = data_cursor_mode;
    setappdata(figure_handle, 'OceanInteractionState', interaction_state);
  end
end

drawnow;
export_mode = resolve_export_mode(options.ExportMode, ui_figure_enabled);
export_target = "plot";
if export_mode == "app"
  export_target = "interface";
end
png_path = fullfile(output_directory, figure_id + ".png");
pdf_path = fullfile(output_directory, figure_id + ".pdf");
svg_path = fullfile(output_directory, figure_id + ".svg");
manifest_entry = struct([]);
manifest_available = false;
manifest_reason = "export_not_performed";
export_api = struct('png', "not_performed", 'pdf', "not_performed", ...
  'svg', "not_requested");
if options.Export
  stale_export = isfile(png_path) || isfile(pdf_path) ...
    || (options.ExportSVG && isfile(svg_path));
  assert(~stale_export, ...
    'Refusing to overwrite an existing interactive export');
  if export_mode == "app"
    assert(~options.ExportSVG, ...
      'SVG app export is unsupported; use ExportMode="graphics" with UseUIFigure=false');
    assert(isempty(options.RequiredToolboxes), ...
      'RequiredToolboxes applies to the audited graphics export path, not exportapp');
    exportapp(figure_handle, png_path);
    exportapp(figure_handle, pdf_path);
    export_api.png = "exportapp";
    export_api.pdf = "exportapp";
    manifest_reason = "exportapp_interface_snapshot_not_supported_by_publication_manifest";
  else
    manifest_entry = oi_export_figure(figure_handle, output_directory, figure_id, ...
      options.PublicationWidthPixels, options.PublicationHeightPixels, ...
      options.PublicationDPI, 'Title', title_text, 'Source', 'interactive MATLAB asset', ...
      'ExportSVG', options.ExportSVG, 'RequiredToolboxes', options.RequiredToolboxes);
    export_api = manifest_entry.runtime.export_api;
    manifest_available = true;
    manifest_reason = "";
    manifest_entry.interaction = struct( ...
      'requested', logical(options.Interactive), ...
      'enabled', logical(interactive_enabled), ...
      'desktop_available', logical(desktop_available), ...
      'data_tips', logical(interactive_enabled), ...
      'brush_selection', logical(interactive_enabled), ...
      'keyboard_accessible', false, ...
      'observation_id_mapping', logical(interactive_enabled), ...
      'cleanup_verified', false, ...
      'headless', struct('supported', true, 'mode', "static_export", ...
        'verified', logical(~desktop_available && options.Export)));
  end
  assert(isfile(png_path) && dir(png_path).bytes > 0, 'PNG export failed');
  assert(isfile(pdf_path) && dir(pdf_path).bytes > 0, 'PDF export failed');
  assert(~options.ExportSVG || (isfile(svg_path) && dir(svg_path).bytes > 0), ...
    'SVG export failed');
end

outputs = struct('Figure', figure_handle, 'Layout', layout, 'Axes', axes_handles, ...
  'Lines', line_handles, 'UncertaintyHandles', uncertainty_handles, ...
  'PNG', png_path, 'PDF', pdf_path, 'SVG', svg_path, ...
  'InteractiveEnabled', interactive_enabled, 'ExportMode', export_mode, ...
  'DesktopAvailable', desktop_available, 'UIFigureEnabled', ui_figure_enabled, ...
  'HeadlessFallbackUsed', options.Interactive && ~desktop_available, ...
  'ExportTarget', export_target, 'ExportPerformed', options.Export, ...
  'SVGRequested', options.ExportSVG, 'ExportAPI', export_api, ...
  'RuntimeRelease', string(version('-release')), ...
  'RequiredProducts', "MATLAB", ...
  'RequiredToolboxes', options.RequiredToolboxes(:), ...
  'PublicationWidthPixels', options.PublicationWidthPixels, ...
  'PublicationHeightPixels', options.PublicationHeightPixels, ...
  'PublicationDPI', options.PublicationDPI, ...
  'PublicationPhysicalWidthIn', options.PublicationWidthPixels / options.PublicationDPI, ...
  'PublicationPhysicalHeightIn', options.PublicationHeightPixels / options.PublicationDPI, ...
  'PublicationExport', options.Export && export_target == "plot", ...
  'FontName', font_name, 'CJKTextPresent', cjk_text_present, ...
  'FontRenderingVerified', false, ...
  'ValidCount', sum(valid_mask), 'MissingCount', sum(~valid_mask), ...
  'UncertaintyPresent', uncertainty_representation ~= "none", ...
  'UncertaintyRepresentation', uncertainty_representation, ...
  'UncertaintyType', uncertainty_type, ...
  'UncertaintyUnit', uncertainty_unit, ...
  'ConfidenceLevel', options.ConfidenceLevel, ...
  'UncertaintyMissingCount', sum(isfinite(value) & ~valid_mask), ...
  'QCPolicy', "preserve", 'QCSummary', qc_summary, ...
  'SourceRowOrigin', source_row_origin, ...
  'ManifestEntry', manifest_entry, 'ManifestAvailable', manifest_available, ...
  'ManifestReason', manifest_reason, ...
  'DataTipTemplateMode', data_tip_template_mode, ...
  'DataCursorUpdateFcn', @safe_data_cursor_update, ...
  'GetSelectedObservationIDs', @() collect_selected_ids(figure_handle, line_handles), ...
  'GetSelectedObservationIdentity', @() collect_selected_identity(figure_handle, line_handles), ...
  'ClearBrushSelection', @() clear_brush_selection(figure_handle, line_handles));
setappdata(figure_handle, 'OceanCallerOwnsFigure', true);
clear figure_cleanup;
if isgraphics(figure_handle) && isappdata(figure_handle, 'OceanCallerOwnsFigure')
  rmappdata(figure_handle, 'OceanCallerOwnsFigure');
end
end

function configure_series(axes_handle, line_handle, metadata, plotted_values, quantity_label, quantity_unit, theme, font_name, data_tip_template_mode)
grid(axes_handle, 'on');
box(axes_handle, 'on');
axes_handle.Layer = 'top';
axes_handle.Color = theme.AxesColor;
axes_handle.FontName = font_name;
axes_handle.FontSize = theme.FontSize;
axes_handle.LineWidth = 0.9;
axes_handle.XColor = theme.TextColor;
axes_handle.YColor = theme.TextColor;
axes_handle.GridColor = theme.GridColor;
axes_handle.GridAlpha = 0.35;
axes_handle.XDir = 'normal';
xlabel(axes_handle, "Time (" + string(metadata.Time.TimeZone) + ")", ...
  'Interpreter', 'none', 'FontName', font_name, 'FontSize', theme.LabelSize, ...
  'Color', theme.TextColor);
ylabel(axes_handle, quantity_label + " (" + quantity_unit + ")", ...
  'Interpreter', 'none', 'FontName', font_name, 'FontSize', theme.LabelSize, ...
  'Color', theme.TextColor);
line_handle.Clipping = 'on';
line_handle.UserData = struct('ObservationID', metadata.ObservationID, ...
  'Time', metadata.Time, 'Station', metadata.Station, ...
  'QCFlag', metadata.QCFlag, 'SourceRow', metadata.SourceRow, ...
  'SourceRowOrigin', metadata.SourceRowOrigin, ...
  'PlottedValue', plotted_values, 'QuantityLabel', quantity_label, ...
  'QuantityUnit', quantity_unit, ...
  'UncertaintyRepresentation', metadata.UncertaintyRepresentation, ...
  'UncertaintyType', metadata.UncertaintyType, ...
  'UncertaintyUnit', metadata.UncertaintyUnit, ...
  'Uncertainty', metadata.Uncertainty, ...
  'UncertaintyLower', metadata.UncertaintyLower, ...
  'UncertaintyUpper', metadata.UncertaintyUpper);
if data_tip_template_mode == "property-only"
  data_tip_rows = [
    dataTipTextRow('Time', 'XData')
    dataTipTextRow(char(quantity_label + " (" + quantity_unit + ")"), 'YData', '%.4g')
  ];
else
  data_tip_rows = [
    dataTipTextRow('Time', metadata.Time)
    dataTipTextRow(quantity_label + " (" + quantity_unit + ")", plotted_values, '%.4g')
    dataTipTextRow('Observation ID', metadata.ObservationID)
    dataTipTextRow('Source row', metadata.SourceRow, '%d')
    dataTipTextRow('Station', metadata.Station)
    dataTipTextRow('QC flag', metadata.QCFlag)
  ];
  if metadata.UncertaintyRepresentation == "magnitude"
    data_tip_rows(end + 1) = dataTipTextRow( ...
      "Uncertainty: " + metadata.UncertaintyType + " (" + metadata.UncertaintyUnit + ")", ...
      metadata.Uncertainty, '%.4g');
  elseif metadata.UncertaintyRepresentation == "bounds"
    data_tip_rows(end + 1) = dataTipTextRow( ...
      "Lower: " + metadata.UncertaintyType + " (" + metadata.UncertaintyUnit + ")", ...
      metadata.UncertaintyLower, '%.4g');
    data_tip_rows(end + 1) = dataTipTextRow( ...
      "Upper: " + metadata.UncertaintyType + " (" + metadata.UncertaintyUnit + ")", ...
      metadata.UncertaintyUpper, '%.4g');
  end
end
line_handle.DataTipTemplate.DataTipRows = data_tip_rows;
end

function mode = resolve_data_tip_template_mode()
if verLessThan('matlab', '9.11')
  mode = "property-only";
else
  mode = "aligned-metadata";
end
end

function capture_brushed_ids(figure_handle, line_handles)
if ~isgraphics(figure_handle)
  return;
end
if ~isappdata(figure_handle, 'OceanInteractionState')
  return;
end
selected_ids = strings(0, 1);
selected_source_rows = zeros(0, 1);
for line_index = 1:numel(line_handles)
  line_handle = line_handles(line_index);
  if ~isgraphics(line_handle) || ~isprop(line_handle, 'BrushData')
    continue;
  end
  brush_data = line_handle.BrushData(:);
  metadata = line_handle.UserData;
  if ~valid_series_identity(line_handle, metadata) ...
      || ~(isnumeric(brush_data) || islogical(brush_data)) ...
      || any(~isfinite(double(brush_data))) ...
      || any(~ismember(double(brush_data), [0 1]))
    continue;
  end
  observation_ids = strtrim(string(metadata.ObservationID(:)));
  source_rows = metadata.SourceRow(:);
  if numel(brush_data) ~= numel(observation_ids)
    continue;
  end
  selected = logical(brush_data);
  selected_ids = [selected_ids; observation_ids(selected)]; %#ok<AGROW>
  selected_source_rows = [selected_source_rows; source_rows(selected)]; %#ok<AGROW>
end
interaction_state = getappdata(figure_handle, 'OceanInteractionState');
if ~isstruct(interaction_state) || ~isfield(interaction_state, 'SelectedObservationIDs')
  return;
end
interaction_state.SelectedObservationIDs = unique(selected_ids, 'stable');
[~, stable_indexes] = unique(selected_ids, 'stable');
interaction_state.SelectedSourceRows = selected_source_rows(stable_indexes);
setappdata(figure_handle, 'OceanInteractionState', interaction_state);
end

function selected_ids = get_selected_ids(figure_handle)
selected_ids = strings(0, 1);
if isgraphics(figure_handle) && isappdata(figure_handle, 'OceanInteractionState')
  interaction_state = getappdata(figure_handle, 'OceanInteractionState');
  if isstruct(interaction_state) && isfield(interaction_state, 'SelectedObservationIDs')
    selected_ids = interaction_state.SelectedObservationIDs;
  end
end
end

function selected_ids = collect_selected_ids(figure_handle, line_handles)
capture_brushed_ids(figure_handle, line_handles);
selected_ids = get_selected_ids(figure_handle);
end

function identity = collect_selected_identity(figure_handle, line_handles)
capture_brushed_ids(figure_handle, line_handles);
identity = table(strings(0, 1), zeros(0, 1), ...
  'VariableNames', {'ObservationID', 'SourceRow'});
if ~isgraphics(figure_handle) || ~isappdata(figure_handle, 'OceanInteractionState')
  return;
end
interaction_state = getappdata(figure_handle, 'OceanInteractionState');
if ~isstruct(interaction_state) ...
    || ~all(isfield(interaction_state, {'SelectedObservationIDs', 'SelectedSourceRows'})) ...
    || numel(interaction_state.SelectedObservationIDs) ~= numel(interaction_state.SelectedSourceRows)
  return;
end
identity = table(interaction_state.SelectedObservationIDs(:), ...
  interaction_state.SelectedSourceRows(:), ...
  'VariableNames', {'ObservationID', 'SourceRow'});
end

function clear_brush_selection(figure_handle, line_handles)
if ~isgraphics(figure_handle) || ~isappdata(figure_handle, 'OceanInteractionState')
  return;
end
for line_index = 1:numel(line_handles)
  if isgraphics(line_handles(line_index)) && isprop(line_handles(line_index), 'BrushData')
    line_handles(line_index).BrushData = zeros(size(line_handles(line_index).YData));
  end
end
interaction_state = getappdata(figure_handle, 'OceanInteractionState');
if ~isstruct(interaction_state) || ~isfield(interaction_state, 'SelectedObservationIDs')
  return;
end
interaction_state.SelectedObservationIDs = strings(0, 1);
interaction_state.SelectedSourceRows = zeros(0, 1);
setappdata(figure_handle, 'OceanInteractionState', interaction_state);
end

function text_rows = safe_data_cursor_update(~, event)
text_rows = {'Data tip unavailable'};
[target, data_index, valid_event] = read_data_cursor_event(event);
if ~valid_event
  return;
end
if ~isgraphics(target) || ~isprop(target, 'XData') || ~isprop(target, 'YData') ...
    || ~isprop(target, 'UserData') || ~isnumeric(data_index) || ~isreal(data_index) ...
    || ~isscalar(data_index) || ~isfinite(data_index) ...
    || data_index ~= fix(data_index) || data_index < 1 ...
    || data_index > numel(target.XData) || data_index > numel(target.YData) ...
    || ~isnumeric(target.YData) || ~isreal(target.YData)
  return;
end
metadata = target.UserData;
if ~valid_series_identity(target, metadata) || ~all(isfield(metadata, ...
    {'ObservationID', 'Station', 'QCFlag', 'Time', 'SourceRow', ...
      'PlottedValue', 'QuantityLabel', 'QuantityUnit'})) ...
    || data_index > numel(metadata.ObservationID) ...
    || data_index > numel(metadata.Station) || data_index > numel(metadata.QCFlag) ...
    || data_index > numel(metadata.Time) || data_index > numel(metadata.SourceRow) ...
    || data_index > numel(metadata.PlottedValue) ...
    || ~isnumeric(metadata.PlottedValue) || ~isreal(metadata.PlottedValue) ...
    || ~isfinite(metadata.PlottedValue(data_index))
  return;
end
[observation_id, valid_id] = safe_metadata_text(metadata.ObservationID, data_index);
[station, valid_station] = safe_metadata_text(metadata.Station, data_index);
[qc_flag, valid_qc] = safe_metadata_text(metadata.QCFlag, data_index);
[quantity_label, valid_label] = safe_metadata_text(metadata.QuantityLabel, 1);
[quantity_unit, valid_unit] = safe_metadata_text(metadata.QuantityUnit, 1);
if ~(valid_id && valid_station && valid_qc && valid_label && valid_unit)
  return;
end
text_rows = {sprintf('Observation ID: %s; Source row: %d', ...
    char(observation_id), metadata.SourceRow(data_index)), ...
  sprintf('Station: %s', char(station)), ...
  sprintf('QC flag: %s', char(qc_flag)), ...
  sprintf('Time: %s', char(string(metadata.Time(data_index)))), ...
  sprintf('%s (%s): %.6g', char(quantity_label), char(quantity_unit), ...
    metadata.PlottedValue(data_index))};
uncertainty_representation = "";
if isfield(metadata, 'UncertaintyRepresentation')
  try
    uncertainty_representation = string(metadata.UncertaintyRepresentation);
  catch
  end
end
if isscalar(uncertainty_representation) && ~ismissing(uncertainty_representation) ...
    && uncertainty_representation == "magnitude" ...
    && all(isfield(metadata, {'Uncertainty', 'UncertaintyType', 'UncertaintyUnit'})) ...
    && data_index <= numel(metadata.Uncertainty) ...
    && isnumeric(metadata.Uncertainty) && isreal(metadata.Uncertainty) ...
    && isfinite(metadata.Uncertainty(data_index))
  [uncertainty_type, valid_type] = safe_metadata_text(metadata.UncertaintyType, 1);
  [uncertainty_unit, valid_unit] = safe_metadata_text(metadata.UncertaintyUnit, 1);
  if ~(valid_type && valid_unit)
    return;
  end
  text_rows{end + 1} = sprintf('Uncertainty (%s, %s): %.6g', ...
    char(uncertainty_type), char(uncertainty_unit), ...
    metadata.Uncertainty(data_index));
elseif isscalar(uncertainty_representation) && ~ismissing(uncertainty_representation) ...
    && uncertainty_representation == "bounds" ...
    && all(isfield(metadata, {'UncertaintyLower', 'UncertaintyUpper', 'UncertaintyUnit'})) ...
    && data_index <= numel(metadata.UncertaintyLower) ...
    && data_index <= numel(metadata.UncertaintyUpper) ...
    && isnumeric(metadata.UncertaintyLower) && isreal(metadata.UncertaintyLower) ...
    && isnumeric(metadata.UncertaintyUpper) && isreal(metadata.UncertaintyUpper) ...
    && isfinite(metadata.UncertaintyLower(data_index)) ...
    && isfinite(metadata.UncertaintyUpper(data_index))
  [uncertainty_unit, valid_unit] = safe_metadata_text(metadata.UncertaintyUnit, 1);
  if ~valid_unit
    return;
  end
  text_rows{end + 1} = sprintf('Uncertainty lower (%s): %.6g', ...
    char(uncertainty_unit), metadata.UncertaintyLower(data_index));
  text_rows{end + 1} = sprintf('Uncertainty upper (%s): %.6g', ...
    char(uncertainty_unit), metadata.UncertaintyUpper(data_index));
end
end

function [target, data_index, valid] = read_data_cursor_event(event)
target = [];
data_index = [];
valid = false;
if isempty(event)
  return;
end
try
  if isstruct(event)
    if ~all(isfield(event, {'Target', 'DataIndex'}))
      return;
    end
  elseif ~isprop(event, 'Target') || ~isprop(event, 'DataIndex')
    return;
  end
  target = event.Target;
  data_index = event.DataIndex;
  valid = true;
catch
  target = [];
  data_index = [];
end
end

function [text_value, valid] = safe_metadata_text(values, index)
text_value = "";
valid = false;
if index > numel(values)
  return;
end
try
  text_value = strtrim(string(values(index)));
  valid = isscalar(text_value) && ~ismissing(text_value) && strlength(text_value) > 0;
catch
  text_value = "";
end
end

function [observation_ids, valid] = normalize_observation_ids(values)
observation_ids = strings(0, 1);
valid = false;
try
  observation_ids = strtrim(string(values(:)));
  valid = all(~ismissing(observation_ids)) ...
    && all(strlength(observation_ids) > 0) ...
    && numel(unique(observation_ids)) == numel(observation_ids);
catch
  observation_ids = strings(0, 1);
end
end

function valid = valid_series_identity(line_handle, metadata)
valid = false;
if ~isgraphics(line_handle) || ~isstruct(metadata) ...
    || ~all(isfield(metadata, {'ObservationID', 'SourceRow'}))
  return;
end
[observation_ids, valid_ids] = normalize_observation_ids(metadata.ObservationID);
source_rows = metadata.SourceRow(:);
point_count = numel(line_handle.YData);
valid = valid_ids && isnumeric(source_rows) && isreal(source_rows) ...
  && numel(observation_ids) == point_count && numel(source_rows) == point_count ...
  && all(isfinite(source_rows)) && all(source_rows == fix(source_rows)) ...
  && all(source_rows >= 1) && numel(unique(source_rows)) == point_count;
end

function export_mode = resolve_export_mode(requested_mode, ui_figure_enabled)
if requested_mode == "auto"
  if ui_figure_enabled
    export_mode = "app";
  else
    export_mode = "graphics";
  end
else
  export_mode = requested_mode;
end
end

function close_interactive_figure(figure_handle, ~)
if ~isgraphics(figure_handle)
  return;
end
if isappdata(figure_handle, 'OceanInteractionState')
  interaction_state = getappdata(figure_handle, 'OceanInteractionState');
  if ~isstruct(interaction_state)
    rmappdata(figure_handle, 'OceanInteractionState');
    delete(figure_handle);
    return;
  end
  if isfield(interaction_state, 'LinkDataEnabled') ...
      && isequal(interaction_state.LinkDataEnabled, true)
    try
      linkdata(figure_handle, 'off');
    catch
    end
  end
  if isfield(interaction_state, 'UsesAxesInteractionModes') ...
      && isequal(interaction_state.UsesAxesInteractionModes, true) ...
      && isfield(interaction_state, 'Axes')
    for axes_index = 1:numel(interaction_state.Axes)
      if isgraphics(interaction_state.Axes(axes_index))
        if isfield(interaction_state, 'DataCursorModes') ...
            && numel(interaction_state.DataCursorModes) >= axes_index ...
            && is_live_handle(interaction_state.DataCursorModes{axes_index})
          disable_data_cursor_mode(interaction_state.DataCursorModes{axes_index});
        else
          disable_axes_data_cursor_mode(interaction_state.Axes(axes_index));
        end
        if isfield(interaction_state, 'BrushModes') ...
            && numel(interaction_state.BrushModes) >= axes_index ...
            && is_live_handle(interaction_state.BrushModes{axes_index})
          disable_brush_mode(interaction_state.BrushModes{axes_index});
        else
          disable_axes_brush_mode(interaction_state.Axes(axes_index));
        end
      end
    end
  end
  if isfield(interaction_state, 'BrushMode') && is_live_handle(interaction_state.BrushMode)
    disable_brush_mode(interaction_state.BrushMode);
  end
  if isfield(interaction_state, 'DataCursorMode') && is_live_handle(interaction_state.DataCursorMode)
    disable_data_cursor_mode(interaction_state.DataCursorMode);
  end
  rmappdata(figure_handle, 'OceanInteractionState');
end
delete(figure_handle);
end

function disable_axes_brush_mode(axes_handle)
try
  brush(axes_handle, 'off');
catch
end
end

function disable_axes_data_cursor_mode(axes_handle)
try
  datacursormode(axes_handle, 'off');
catch
end
end

function disable_brush_mode(brush_mode)
try
  if isprop(brush_mode, 'ActionPostCallback')
    brush_mode.ActionPostCallback = [];
  end
  if isprop(brush_mode, 'Enable')
    brush_mode.Enable = 'off';
  end
catch
end
end

function disable_data_cursor_mode(data_cursor_mode)
try
  if isprop(data_cursor_mode, 'UpdateFcn')
    data_cursor_mode.UpdateFcn = [];
  end
  if isprop(data_cursor_mode, 'Enable')
    data_cursor_mode.Enable = 'off';
  end
catch
end
end

function valid = is_live_handle(handle_value)
valid = false;
if isempty(handle_value) || ~isscalar(handle_value)
  return;
end
try
  valid = isvalid(handle_value);
catch
end
end

function close_unowned_figure(figure_handle)
if ~isempty(figure_handle) && isgraphics(figure_handle) ...
    && ~(isappdata(figure_handle, 'OceanCallerOwnsFigure') ...
      && isequal(getappdata(figure_handle, 'OceanCallerOwnsFigure'), true))
  close(figure_handle);
end
end

function assert_table_unit(data, variable_name, expected_unit)
variable_names = string(data.Properties.VariableNames);
variable_index = find(variable_names == variable_name, 1);
assert(~isempty(variable_index), 'ocean:table:MissingVariable', ...
  'The requested table variable is unavailable');
variable_units = data.Properties.VariableUnits;
if isempty(variable_units) || numel(variable_units) < variable_index
  return;
end
declared_unit = string(variable_units{variable_index});
assert(strlength(declared_unit) == 0 || declared_unit == expected_unit, ...
  'ocean:table:UnitMismatch', ...
  'Table VariableUnits must match the explicitly supplied unit');
end

function [font_name, cjk_text_present] = resolve_interaction_font(requested_font, fallback_font, text_values)
installed_fonts = strtrim(string(listfonts));
assert(~isempty(installed_fonts), 'ocean:interaction:FontUnavailable', ...
  'MATLAB did not report any installed fonts');
cjk_text_present = contains_cjk_text(text_values);
requested_font = strtrim(requested_font);
if strlength(requested_font) > 0
  assert(oi_font_available(requested_font, installed_fonts), ...
    'ocean:interaction:FontUnavailable', ...
    'The explicitly requested FontName is not installed');
  font_name = requested_font;
  assert(~cjk_text_present || is_configured_cjk_font(font_name), ...
    'ocean:interaction:CJKFontUnavailable', ...
    'CJK text requires a configured CJK-capable FontName');
  return;
end
if cjk_text_present
  candidates = ["WenQuanYi Zen Hei" "Noto Sans CJK SC" "Noto Sans CJK TC" "Noto Sans CJK HK" ...
    "Noto Sans CJK JP" "Noto Sans CJK KR" "Source Han Sans SC" ...
    "Droid Sans Fallback" "Microsoft YaHei" ...
    "PingFang SC" "SimHei" "SimSun" ...
    "Arial Unicode MS"];
else
  candidates = ["WenQuanYi Zen Hei" string(fallback_font)];
end
font_name = "";
for candidate_index = 1:numel(candidates)
  if oi_font_available(candidates(candidate_index), installed_fonts)
    font_name = candidates(candidate_index);
    break;
  end
end
assert(strlength(font_name) > 0, 'ocean:interaction:CJKFontUnavailable', ...
  'No configured CJK-capable font candidate is installed; supply a verified FontName');
end

function valid = is_configured_cjk_font(font_name)
normalized = lower(string(font_name));
tokens = ["noto sans cjk" "source han" "yahei" "pingfang" ...
  "wenquanyi" "droid sans fallback" "simhei" "simsun" ...
  "heiti" "songti" "arial unicode"];
valid = false;
for token_index = 1:numel(tokens)
  valid = valid || contains(normalized, tokens(token_index));
end
end

function present = contains_cjk_text(text_values)
present = false;
text_values = string(text_values(:));
for text_index = 1:numel(text_values)
  code_units = double(char(text_values(text_index)));
  if any((code_units >= hex2dec('3400') & code_units <= hex2dec('9FFF')) ...
      | (code_units >= hex2dec('F900') & code_units <= hex2dec('FAFF')))
    present = true;
    return;
  end
end
end
