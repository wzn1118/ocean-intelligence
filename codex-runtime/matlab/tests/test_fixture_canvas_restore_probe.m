function report = test_fixture_canvas_restore_probe(outputDirectory)
arguments
    outputDirectory (1,1) string
end
assert(~ismissing(outputDirectory) && strlength(strtrim(outputDirectory)) > 0, ...
    "test_fixture_canvas_restore_probe:Output", "An explicit fresh output directory is required");
create_directory(outputDirectory);
testsDirectory = fileparts(mfilename("fullpath"));
matlabDirectory = fileparts(testsDirectory);
originalPath = path;
pathCleanup = onCleanup(@() path(originalPath));
addpath(fullfile(matlabDirectory, "assets"), testsDirectory);
reportPath = fullfile(outputDirectory, "fixture-canvas-restore-probe.json");
report = struct("schema_version", 1, "status", "running", "generated_at", utc_time(), ...
    "completed_at", "", "release", "R" + string(version('-release')), "matlab_version", string(version), ...
    "case_id", "crossed-time-depth-temperature", "data_source", "synthetic fixture, not observations", ...
    "scope", "restore diagnostic only; completion is not nonblank PNG or restoration approval", ...
    "process_scope", "sequential variants in the same MATLAB process; process state is not reset", ...
    "fresh_process_per_variant", false, "figure_policy", "each variant owns a newly built figure", ...
    "jvm_available", usejava('jvm'), "desktop_available", usejava('desktop'), "display", string(getenv('DISPLAY')), ...
    "screen_pixels_per_inch", get(groot, "ScreenPixelsPerInch"), ...
    "counts_toward_main_probe", false, "counts_toward_stage", false, "counts_toward_score", false, ...
    "max_png_exports_per_invocation", 8, "max_pdf_exports_per_invocation", 6, ...
    "artifact_paths_relative_to", "candidate_directory", "external_inspection_status", "pending", ...
    "png_content_status", "not_verified", "visual_verified", false, "geometry_complete", false, ...
    "font_embedding_verified", false, "exact_page_verified", false, "restoration_verified", false, ...
    "data_scope", "captured native properties only; no full science, callbacks or mutable UserData handle proof", ...
    "skip_reason", "", "error_identifier", "", "error_message", "");
report.candidates = cell(0, 1);
report.summary = struct("candidate_count", 0, "completed_unreviewed", 0, "failed", 0, "pending", 0);
if ~any(report.release == ["R2021a" "R2024b"])
    report.status = "not_applicable";
    report.skip_reason = "old_release_restore_diagnostic_only";
    report.completed_at = utc_time();
    write_json(reportPath, report);
    fprintf("MATLAB_FIXTURE_CANVAS_RESTORE_PROBE_STATUS=not_applicable\n");
    return;
end
variants = ["baseline" "skip-reference-pdf" "skip-canvas-pdf" "draw-before-delete"];
for variantIndex = 1:numel(variants)
    report.candidates{variantIndex, 1} = struct("id", variants(variantIndex), "status", "pending");
end
write_json(reportPath, report);
failure = [];
try
    builderPath = fullfile(testsDirectory, "build_native_pdf_fixture_case.m");
    assert(string(which("build_native_pdf_fixture_case")) == builderPath, ...
        "test_fixture_canvas_restore_probe:BuilderPath", "The probe must use the checkout builder");
    fixtureDirectory = fullfile(matlabDirectory, "evals", "fixtures");
    report.input = file_record(fullfile(fixtureDirectory, "crossed_time_depth_temperature.json"));
    report.builder = file_record(builderPath);
    report.probe_source = file_record(string(mfilename("fullpath")) + ".m");
    for variantIndex = 1:numel(variants)
        [record, variantFailure] = run_variant(outputDirectory, fixtureDirectory, variants(variantIndex), report.input);
        report.candidates{variantIndex} = record;
        if isempty(failure) && ~isempty(variantFailure)
            failure = variantFailure;
        end
        write_json(reportPath, report);
    end
    assert(isequaln(file_record(report.input.file), report.input) ...
        && isequaln(file_record(report.builder.file), report.builder) ...
        && isequaln(file_record(report.probe_source.file), report.probe_source), ...
        "test_fixture_canvas_restore_probe:SourceChanged", "Fixture, builder or probe bytes changed");
    report.status = "completed_unreviewed";
    if ~isempty(failure)
        report.status = "incomplete";
    end
catch errorRecord
    report.status = "failed";
    failure = errorRecord;
end
statuses = strings(numel(report.candidates), 1);
for candidateIndex = 1:numel(report.candidates)
    statuses(candidateIndex) = report.candidates{candidateIndex}.status;
end
report.summary = struct("candidate_count", numel(variants), ...
    "completed_unreviewed", sum(statuses == "completed_unreviewed"), ...
    "failed", sum(statuses == "failed"), "pending", sum(statuses == "pending"));
if ~isempty(failure)
    report.error_identifier = string(failure.identifier);
    report.error_message = string(failure.message);
end
report.completed_at = utc_time();
write_json(reportPath, report);
fprintf("MATLAB_FIXTURE_CANVAS_RESTORE_PROBE_JSON=%s\n", reportPath);
fprintf("MATLAB_FIXTURE_CANVAS_RESTORE_PROBE_STATUS=%s\n", report.status);
if ~isempty(failure)
    rethrow(failure);
end
end

function [record, failure] = run_variant(outputDirectory, fixtureDirectory, variant, inputRecord)
directory = fullfile(outputDirectory, variant);
recordPath = fullfile(directory, "candidate.json");
record = struct("id", variant, "status", "pending", "last_phase", "build", ...
    "fresh_owned_figure", false, "owned_figure_closed", false, "input", inputRecord, ...
    "snapshots", struct(), "artifacts", struct(), ...
    "error_identifier", "", "error_message", "");
record.artifacts.reference_png = artifact_record("reference.png");
record.artifacts.reference_pdf = artifact_record("reference.pdf");
record.artifacts.canvas_pdf = artifact_record("canvas.pdf");
record.artifacts.terminal_png = artifact_record("terminal.png");
figureHandle = gobjects(0);
panelHandle = gobjects(0);
directoryCreated = false;
failure = [];
try
    create_directory(directory);
    directoryCreated = true;
    write_json(recordPath, record);
    existingFigures = findall(groot, "Type", "figure");
    [figureHandle, record.builder_details] = build_native_pdf_fixture_case("crossed-time-depth-temperature", fixtureDirectory);
    assert(isscalar(figureHandle) && isgraphics(figureHandle, "figure") ...
        && ~any(arrayfun(@(existing) isequal(existing, figureHandle), existingFigures)), ...
        "test_fixture_canvas_restore_probe:FigureOwnership", "Each variant must receive a new figure");
    figureCleanup = onCleanup(@() close_owned_figure(figureHandle));
    record.fresh_owned_figure = true;
    assert(string(record.builder_details.input_sha256) == inputRecord.sha256, ...
        "test_fixture_canvas_restore_probe:InputMismatch", "Each variant must build from the same input bytes");
    drawnow;
    originalObjects = original_objects(figureHandle);
    originalParents = cellfun(@(object) get(object, "Parent"), originalObjects, "UniformOutput", false);
    originalChildren = get(figureHandle, "Children");
    originalCurrentAxes = figureHandle.CurrentAxes;
    originalValues = capture_values(originalObjects);
    checkpoint("constructed");
    export_one("reference_png", figureHandle);
    if variant == "skip-reference-pdf"
        record.artifacts.reference_pdf.status = "omitted_by_variant";
    else
        export_one("reference_pdf", figureHandle);
    end
    checkpoint("after_reference");
    record.last_phase = "root_inventory";
    roots = allchild(figureHandle);
    roots = roots(~arrayfun(@excluded_root, roots));
    assert(~isempty(roots) && all(arrayfun(@(object) ...
        isa(object, "matlab.graphics.layout.TiledChartLayout") || isgraphics(object, "axes"), roots)), ...
        "test_fixture_canvas_restore_probe:Roots", "Unsupported or nonempty annotation root");
    rootStates = arrayfun(@root_state, roots, "UniformOutput", false);
    originalCurrentAxes = figureHandle.CurrentAxes;
    record.last_phase = "wrap";
    panelHandle = uipanel("Parent", figureHandle, "Units", "inches", "Position", [0 0 8 5], ...
        "BorderType", "none", "BackgroundColor", "white", "Tag", "fixture-canvas-panel");
    for rootIndex = 1:numel(roots)
        set(roots(rootIndex), "Parent", panelHandle);
        restore_geometry(roots(rootIndex), rootStates{rootIndex});
    end
    backgroundAxes = axes("Parent", panelHandle, "Units", "inches", ...
        "PositionConstraint", "innerposition", "Position", [0 0 8 5], ...
        "XLim", [0 576], "YLim", [0 360], "XTick", [], "YTick", [], ...
        "XColor", "none", "YColor", "none", "Color", "none", "Box", "off", ...
        "Visible", "on", "Tag", "fixture-canvas-background");
    rectangle(backgroundAxes, "Position", [0 0 576 360], "FaceColor", "white", ...
        "EdgeColor", "none", "LineStyle", "none", "Clipping", "on", "Tag", "fixture-canvas-face");
    uistack(backgroundAxes, "bottom");
    figureHandle.CurrentAxes = originalCurrentAxes;
    drawnow;
    checkpoint("wrapped");
    if variant == "skip-canvas-pdf"
        record.artifacts.canvas_pdf.status = "omitted_by_variant";
    else
        export_one("canvas_pdf", panelHandle);
    end
    checkpoint("after_canvas");
    record.last_phase = "reparent";
    for rootIndex = 1:numel(roots)
        assert(isgraphics(roots(rootIndex)), "test_fixture_canvas_restore_probe:DeletedRoot", "Original root deleted");
        set(roots(rootIndex), "Parent", rootStates{rootIndex}.Parent);
        restore_geometry(roots(rootIndex), rootStates{rootIndex});
    end
    remaining = get(figureHandle, "Children");
    extraChildren = remaining(~ismember(remaining, originalChildren));
    set(figureHandle, "Children", [originalChildren(:); extraChildren(:)]);
    checkpoint("reparented_before_delete");
    assert(isempty(originals_in_panel(panelHandle, originalObjects)), ...
        "test_fixture_canvas_restore_probe:OriginalsStillInPanel", "Refusing to delete a panel containing original objects");
    if variant == "draw-before-delete"
        record.last_phase = "draw_before_delete";
        drawnow;
    end
    record.last_phase = "delete_panel";
    delete(panelHandle);
    checkpoint("after_panel_delete");
    record.last_phase = "restore_current_axes";
    figureHandle.CurrentAxes = originalCurrentAxes;
    checkpoint("after_current_axes");
    record.last_phase = "final_drawnow";
    drawnow;
    checkpoint("after_final_drawnow");
    export_one("terminal_png", figureHandle);
    checkpoint("after_terminal_png");
    record.last_phase = "capture_terminal_values";
    finalValues = capture_values(originalObjects);
    save(fullfile(directory, "captured-native-values.mat"), "originalValues", "finalValues", "-v7");
    record.captured_values = file_record(fullfile(directory, "captured-native-values.mat"));
    state = record.snapshots.after_terminal_png;
    record.last_phase = "validate_originals";
    assert(all(state.original_live) && all(state.parent_equal) ...
        && isequal(get(figureHandle, "Children"), originalChildren) && isequaln(originalValues, finalValues), ...
        "test_fixture_canvas_restore_probe:OriginalChanged", "Original object, parent, child order or captured value changed");
    for rootIndex = 1:numel(roots)
        assert(isequaln(root_state(roots(rootIndex)), rootStates{rootIndex}), ...
            "test_fixture_canvas_restore_probe:RootChanged", "Original root geometry was not restored");
    end
    record.status = "completed_unreviewed";
catch errorRecord
    failure = errorRecord;
    record.status = "failed";
    record.error_identifier = string(errorRecord.identifier);
    record.error_message = string(errorRecord.message);
    fprintf(2, "MATLAB_FIXTURE_CANVAS_RESTORE_CANDIDATE_FAILED=%s PHASE=%s %s: %s\n", ...
        variant, record.last_phase, errorRecord.identifier, errorRecord.message);
end
if record.fresh_owned_figure
    close_owned_figure(figureHandle);
    record.owned_figure_closed = ~isgraphics(figureHandle);
    clear figureCleanup;
end
if directoryCreated
    write_json(recordPath, record);
end

    function checkpoint(phase)
        record.last_phase = phase;
        record.snapshots.(phase) = scene_state(figureHandle, panelHandle, originalObjects, ...
            originalParents, originalValues, originalCurrentAxes);
        write_json(recordPath, record);
    end

    function export_one(kind, target)
        record.last_phase = kind;
        write_json(recordPath, record);
        record.artifacts.(kind) = export_artifact(directory, record.artifacts.(kind), target, kind);
        write_json(recordPath, record);
        assert(record.artifacts.(kind).status == "exported", ...
            "test_fixture_canvas_restore_probe:Export", "%s: %s", kind, record.artifacts.(kind).error_message);
    end
end

function record = artifact_record(filename)
record = struct("file", filename, "status", "not_attempted", "api_invoked", false, ...
    "call_succeeded", false, "export_object_class", "", "bytes", 0, "sha256", "", ...
    "png_pixels", [], "error_identifier", "", "error_message", "");
end

function record = export_artifact(directory, record, target, kind)
filePath = fullfile(directory, record.file);
record.status = "failed";
try
    assert(~isfile(filePath) && ~isfolder(filePath), "test_fixture_canvas_restore_probe:StaleArtifact", "Refusing to overwrite output");
    record.export_object_class = string(class(target));
    record.api_invoked = true;
    if kind == "canvas_pdf"
        exportgraphics(target, filePath, "ContentType", "vector", "BackgroundColor", "white");
    elseif kind == "reference_pdf"
        print(target, filePath, "-dpdf", "-painters");
    else
        print(target, filePath, "-dpng", "-r300");
    end
    record.call_succeeded = true;
catch errorRecord
    record.error_identifier = string(errorRecord.identifier);
    record.error_message = string(errorRecord.message);
end
try
    measured = file_record(filePath);
    record.bytes = measured.bytes;
    record.sha256 = measured.sha256;
    if endsWith(record.file, ".png")
        information = imfinfo(filePath);
        record.png_pixels = [information.Width information.Height];
        assert(isequal(record.png_pixels, [2400 1500]), "test_fixture_canvas_restore_probe:PNGDimensions", "PNG dimensions changed");
    end
    if record.call_succeeded
        record.status = "exported";
    end
catch errorRecord
    if strlength(record.error_message) == 0
        record.error_identifier = string(errorRecord.identifier);
        record.error_message = string(errorRecord.message);
    end
end
end

function excluded = excluded_root(object)
excluded = isgraphics(object, "uimenu") || isgraphics(object, "uitoolbar") || isgraphics(object, "uicontextmenu");
if isa(object, "matlab.graphics.shape.internal.AnnotationPane")
    excluded = string(object.Tag) == "scribeOverlay" && isempty(allchild(object));
end
end

function state = root_state(object)
state = struct("Parent", object.Parent, "Units", object.Units, "Position", object.Position, ...
    "OuterPosition", object.OuterPosition, "PositionConstraint", object.PositionConstraint);
end

function restore_geometry(object, state)
set(object, "Units", state.Units);
set(object, "Position", state.Position);
set(object, "OuterPosition", state.OuterPosition);
set(object, "PositionConstraint", state.PositionConstraint);
if string(state.PositionConstraint) == "innerposition"
    object.Position = state.Position;
else
    object.OuterPosition = state.OuterPosition;
end
end

function state = scene_state(figureHandle, panelHandle, objects, parents, values, savedAxes)
state = struct("figure", readable_properties(figureHandle, ...
    ["Visible" "Renderer" "RendererMode" "GraphicsSmoothing" "InvertHardcopy" "Color" ...
     "WindowStyle" "PaperUnits" "PaperPosition" "PaperSize" "PaperPositionMode"]), ...
    "current_axes", {describe_handles(figureHandle.CurrentAxes, objects)}, ...
    "current_axes_matches_saved", isequal(figureHandle.CurrentAxes, savedAxes), ...
    "current_figure_matches", isequal(get(groot, "CurrentFigure"), figureHandle), ...
    "visible_figure_children", {describe_handles(get(figureHandle, "Children"), objects)}, ...
    "all_figure_children", {describe_handles(allchild(figureHandle), objects)}, ...
    "original_live", cellfun(@live_object, objects), "parent_equal", false(numel(objects), 1), ...
    "captured_values_equal", isequaln(values, capture_values(objects)), ...
    "panel_live", isscalar(panelHandle) && isgraphics(panelHandle), "panel_children", {{}}, "originals_in_panel", []);
currentObjects = findall(figureHandle);
untracked = currentObjects(~arrayfun(@(object) any(cellfun(@(original) isequal(original, object), objects)), currentObjects));
state.untracked_objects = describe_handles(untracked, objects);
for objectIndex = 1:numel(objects)
    if live_object(objects{objectIndex})
        state.parent_equal(objectIndex) = isequal(get(objects{objectIndex}, "Parent"), parents{objectIndex});
    end
end
if isscalar(panelHandle) && isgraphics(panelHandle)
    state.panel_children = describe_handles(allchild(panelHandle), objects);
    state.originals_in_panel = originals_in_panel(panelHandle, objects);
    state.panel = readable_properties(panelHandle, ["Visible" "Units" "Position" "BackgroundColor"]);
end
end

function identifiers = originals_in_panel(panelHandle, objects)
descendants = num2cell(findall(panelHandle));
identifiers = find(cellfun(@(object) any(cellfun(@(descendant) isequal(object, descendant), descendants)), objects));
end

function records = describe_handles(handles, originals)
records = cell(numel(handles), 1);
for handleIndex = 1:numel(handles)
    object = handles(handleIndex);
    records{handleIndex} = struct("class", string(class(object)), ...
        "original_indices", find(cellfun(@(original) isequal(original, object), originals)), ...
        "direct_child_count", numel(allchild(object)), ...
        "properties", readable_properties(object, ["Tag" "Visible" "HandleVisibility" "Units" ...
            "Position" "OuterPosition" "SortMethod" "Layer" "BackgroundColor"]));
end
end

function objects = original_objects(root)
objects = num2cell(findall(root));
objectIndex = 1;
while objectIndex <= numel(objects)
    owner = objects{objectIndex};
    for property = ["Title" "Subtitle" "XLabel" "YLabel" "ZLabel" "Label"]
        if isprop(owner, property)
            candidate = owner.(property);
            if live_object(candidate) && ~any(cellfun(@(object) isequal(object, candidate), objects))
                objects{end + 1, 1} = candidate;
            end
        end
    end
    objectIndex = objectIndex + 1;
end
end

function valid = live_object(object)
valid = isscalar(object) && (isgraphics(object) || (isa(object, "handle") && isvalid(object)));
end

function values = capture_values(objects)
properties = ["XData" "YData" "ZData" "CData" "AlphaData" "SizeData" "UData" "VData" ...
    "XNegativeDelta" "XPositiveDelta" "YNegativeDelta" "YPositiveDelta" "UserData" ...
    "Color" "LineStyle" "LineWidth" "Marker" "MarkerSize" "String" "FontName" "FontSize" ...
    "FontWeight" "FontAngle" "Interpreter" "Visible" "Clipping" "CLim" "Colormap" "XLim" "YLim"];
values = cell(numel(objects), 1);
for objectIndex = 1:numel(objects)
    values{objectIndex} = readable_properties(objects{objectIndex}, properties);
end
end

function record = readable_properties(object, properties)
record = struct("values", struct(), "unavailable", strings(0, 1), "errors", strings(0, 1));
for property = properties
    if ~live_object(object) || ~isprop(object, property)
        record.unavailable(end + 1, 1) = property;
        continue;
    end
    try
        record.values.(property) = object.(property);
    catch errorRecord
        record.unavailable(end + 1, 1) = property;
        record.errors(end + 1, 1) = property + ": " + string(errorRecord.identifier);
    end
end
end

function record = file_record(filePath)
information = dir(filePath);
assert(isscalar(information) && ~information.isdir && information.bytes > 0, ...
    "test_fixture_canvas_restore_probe:File", "Missing or empty file: %s", filePath);
record = struct("file", filePath, "bytes", information.bytes, "sha256", string(oi_sha256_file(filePath)));
end

function create_directory(directory)
assert(~isfile(directory) && ~isfolder(directory), "test_fixture_canvas_restore_probe:FreshOutput", "Refusing to reuse %s", directory);
[created, message] = mkdir(directory);
assert(created, "test_fixture_canvas_restore_probe:Directory", "%s", message);
end

function write_json(filePath, payload)
fileHandle = fopen(filePath, "w", "n", "UTF-8");
assert(fileHandle >= 0, "test_fixture_canvas_restore_probe:Write", "Cannot write diagnostic JSON");
cleanup = onCleanup(@() fclose(fileHandle));
fprintf(fileHandle, "%s\n", jsonencode(payload));
end

function close_owned_figure(figureHandle)
if isscalar(figureHandle) && isgraphics(figureHandle, "figure")
    delete(figureHandle);
end
end

function value = utc_time()
value = string(datetime("now", "TimeZone", "UTC", "Format", "yyyy-MM-dd'T'HH:mm:ss'Z'"));
end
