function report = test_native_pdf_fixture_canvas(outputDirectory)
arguments
    outputDirectory (1,1) string
end
assert(strlength(strtrim(outputDirectory)) > 0 && ~ismissing(outputDirectory), ...
    "test_native_pdf_fixture_canvas:Output", "An explicit fresh output directory is required");
assert(~isfolder(outputDirectory) && ~isfile(outputDirectory), ...
    "test_native_pdf_fixture_canvas:FreshOutput", "Refusing to reuse %s", outputDirectory);
[created, message] = mkdir(outputDirectory);
assert(created, "test_native_pdf_fixture_canvas:Directory", "%s", message);
matlabDirectory = fileparts(fileparts(mfilename("fullpath")));
fixtureDirectory = fullfile(matlabDirectory, "evals", "fixtures");
originalPath = path;
pathCleanup = onCleanup(@() path(originalPath));
addpath(fullfile(matlabDirectory, "assets"));
release = "R" + string(version('-release'));
report = struct("schema_version", 1, "status", "running", ...
    "release", release, "generated_at", utc_time(), "completed_at", "", ...
    "scope", "native fixture canvas diagnostic; not a production export strategy", ...
    "data_source", "synthetic benchmark, not observed ocean conditions", ...
    "counts_toward_stage", false, "target_page_inches", [8 5], ...
    "target_page_points", [576 360], "external_inspection_status", "pending", ...
    "exact_page_verified", false, "font_embedding_verified", false, ...
    "layout_verified", false, "skip_reason", "", "candidates", struct([]));
reportPath = fullfile(outputDirectory, "native-fixture-canvas.json");
if ~any(release == ["R2021a" "R2024b"])
    report.status = "not_applicable";
    report.skip_reason = "old_release_experiment_only; retain existing exact exportgraphics strategy";
else
    caseIds = ["crossed-time-depth-temperature" "repeat-cast-salinity-profiles" ...
        "paired-observation-model" "paired-interactive"];
    report.candidates = repmat(candidate_record(""), numel(caseIds), 1);
    for caseIndex = 1:numel(caseIds)
        report.candidates(caseIndex) = candidate_record(caseIds(caseIndex));
    end
    write_json(reportPath, report);
    for caseIndex = 1:numel(caseIds)
        report.candidates(caseIndex) = run_candidate(outputDirectory, ...
            fixtureDirectory, report.candidates(caseIndex));
        write_json(reportPath, report);
    end
    report.status = "completed_diagnostics_only";
    if any([report.candidates.status] ~= "completed_diagnostic")
        report.status = "incomplete";
    end
end
report.completed_at = utc_time();
write_json(reportPath, report);
fprintf("MATLAB_NATIVE_FIXTURE_CANVAS_REPORT=%s\n", reportPath);
fprintf("MATLAB_NATIVE_FIXTURE_CANVAS_STATUS=%s\n", report.status);
clear pathCleanup;
end

function record = candidate_record(identifier)
record = struct("id", identifier, "status", "pending", "details", struct(), ...
    "reference_png", artifact_record(identifier + "/reference.png", "print -dpng -r300"), ...
    "reference_pdf", artifact_record(identifier + "/reference.pdf", "print -dpdf -painters"), ...
    "canvas_pdf", artifact_record(identifier + "/canvas.pdf", "exportgraphics(panel, ContentType=vector)"), ...
    "restored_png", artifact_record(identifier + "/restored.png", "print -dpng -r300"), ...
    "geometry", struct(), "wrapper_geometry", struct(), "data_preservation", struct(), ...
    "restoration_attempted", false, "restoration_completed", false, ...
    "root_state_preserved", false, "parent_identity_preserved", false, ...
    "root_inventory", struct(), "excluded_root_classes", strings(0, 1), ...
    "callback_restoration_verified", false, ...
    "restoration_error", "", "error_identifier", "", "error_message", "");
end

function record = artifact_record(fileName, requestedApi)
record = struct("file", fileName, "requested_api", requestedApi, ...
    "status", "not_attempted", "api_invoked", false, "call_succeeded", false, ...
    "export_object_class", "", ...
    "bytes", 0, "sha256", "", "png_pixels", [], ...
    "error_identifier", "", "error_message", "");
end

function record = run_candidate(outputDirectory, fixtureDirectory, record)
candidateDirectory = fullfile(outputDirectory, record.id);
[created, message] = mkdir(candidateDirectory);
assert(created, "test_native_pdf_fixture_canvas:Directory", "%s", message);
recordPath = fullfile(candidateDirectory, "candidate.json");
write_json(recordPath, record);
figureHandle = gobjects(0);
panelHandle = gobjects(0);
roots = gobjects(0);
rootState = cell(0, 1);
try
    [figureHandle, record.details] = build_native_pdf_fixture_case(record.id, fixtureDirectory);
    figureCleanup = onCleanup(@() close_figure(figureHandle));
    drawnow;
    originalObjects = original_objects(figureHandle);
    originalChildren = get(figureHandle, "Children");
    originalParents = cell(size(originalObjects));
    for objectIndex = 1:numel(originalObjects)
        if isprop(originalObjects{objectIndex}, "Parent")
            originalParents{objectIndex} = originalObjects{objectIndex}.Parent;
        end
    end
    beforeData = data_state(originalObjects);
    record.geometry.constructed = geometry_state(originalObjects);
    record.reference_png = export_artifact(outputDirectory, record.reference_png, figureHandle, "png");
    record.reference_pdf = export_artifact(outputDirectory, record.reference_pdf, figureHandle, "reference-pdf");
    record.geometry.before_wrap = geometry_state(originalObjects);
    record.data_preservation.after_reference = same_data(originalObjects, beforeData);
    write_json(recordPath, record);
    assert_exports(record, ["reference_png" "reference_pdf"], outputDirectory);

    allRoots = allchild(figureHandle);
    record.root_inventory = geometry_state(num2cell(allRoots));
    excludedRoots = arrayfun(@(object) isgraphics(object, "uimenu") ...
        || isgraphics(object, "uitoolbar") || isgraphics(object, "uicontextmenu"), allRoots);
    excludedHandles = allRoots(excludedRoots);
    for excludedIndex = 1:numel(excludedHandles)
        record.excluded_root_classes(end + 1, 1) = string(class(excludedHandles(excludedIndex)));
    end
    roots = allRoots(~excludedRoots);
    assert(~isempty(roots) && all(arrayfun(@supported_root, roots)), ...
        "test_native_pdf_fixture_canvas:RootObjects", ...
        "Only traditional axes or tiled-layout roots are supported by this diagnostic");
    rootState = cell(numel(roots), 1);
    for rootIndex = 1:numel(roots)
        rootState{rootIndex} = root_state(roots(rootIndex));
    end
    originalCurrentAxes = figureHandle.CurrentAxes;
    panelHandle = uipanel("Parent", figureHandle, "Units", "inches", ...
        "Position", [0 0 8 5], "BorderType", "none", "BackgroundColor", "white", ...
        "Tag", "fixture-canvas-panel");
    for rootIndex = 1:numel(roots)
        set(roots(rootIndex), "Parent", panelHandle);
        restore_geometry(roots(rootIndex), rootState{rootIndex});
    end
    backgroundAxes = axes("Parent", panelHandle, "Units", "inches", ...
        "PositionConstraint", "innerposition", "Position", [0 0 8 5], ...
        "XLim", [0 576], "YLim", [0 360], "XTick", [], "YTick", [], ...
        "XColor", "none", "YColor", "none", "Color", "none", "Box", "off", ...
        "Visible", "on", "Tag", "fixture-canvas-background");
    rectangle(backgroundAxes, "Position", [0 0 576 360], "FaceColor", "white", ...
        "EdgeColor", "none", "LineStyle", "none", "Clipping", "on", ...
        "Tag", "fixture-canvas-face");
    uistack(backgroundAxes, "bottom");
    figureHandle.CurrentAxes = originalCurrentAxes;
    drawnow;
    record.geometry.after_wrap = geometry_state(originalObjects);
    record.wrapper_geometry.after_wrap = geometry_state(original_objects(panelHandle));
    record.data_preservation.after_wrap = same_data(originalObjects, beforeData);
    write_json(recordPath, record);
    record.canvas_pdf = export_artifact(outputDirectory, record.canvas_pdf, panelHandle, "canvas-pdf");
    record.geometry.after_pdf = geometry_state(originalObjects);
    record.wrapper_geometry.after_pdf = geometry_state(original_objects(panelHandle));
    record.data_preservation.after_pdf = same_data(originalObjects, beforeData);
    write_json(recordPath, record);

    record.restoration_attempted = true;
    restore_roots(roots, rootState, figureHandle, originalChildren);
    delete(panelHandle);
    panelHandle = gobjects(0);
    figureHandle.CurrentAxes = originalCurrentAxes;
    drawnow;
    record.restoration_completed = true;
    record.root_state_preserved = isequal(get(figureHandle, "Children"), originalChildren);
    for rootIndex = 1:numel(roots)
        record.root_state_preserved = record.root_state_preserved ...
            && isequaln(root_state(roots(rootIndex)), rootState{rootIndex});
    end
    record.parent_identity_preserved = true;
    for objectIndex = 1:numel(originalObjects)
        object = originalObjects{objectIndex};
        if isprop(object, "Parent")
            record.parent_identity_preserved = record.parent_identity_preserved ...
                && isequal(object.Parent, originalParents{objectIndex});
        end
    end
    record.geometry.after_restore = geometry_state(originalObjects);
    record.data_preservation.after_restore = same_data(originalObjects, beforeData);
    record.restored_png = export_artifact(outputDirectory, record.restored_png, figureHandle, "png");
    record.geometry.after_restored_png = geometry_state(originalObjects);
    record.data_preservation.after_restored_png = same_data(originalObjects, beforeData);
    write_json(recordPath, record);
    assert_exports(record, ["reference_png" "reference_pdf" "canvas_pdf" "restored_png"], outputDirectory);
    assert(record.root_state_preserved && record.parent_identity_preserved, ...
        "test_native_pdf_fixture_canvas:RootStateChanged", ...
        "Root geometry, parent or original child order was not restored exactly");
    assert(all(structfun(@(value) isequal(value, true), record.data_preservation)), ...
        "test_native_pdf_fixture_canvas:DataChanged", "Native data, identity or paint changed");
    geometryNames = fieldnames(record.geometry);
    assert(numel(geometryNames) == 6 && all(cellfun(@(name) ...
        record.geometry.(name).status == "captured", geometryNames)), ...
        "test_native_pdf_fixture_canvas:Geometry", "All six geometry captures are required");
    assert(record.wrapper_geometry.after_wrap.status == "captured" ...
        && record.wrapper_geometry.after_pdf.status == "captured", ...
        "test_native_pdf_fixture_canvas:WrapperGeometry", "Both wrapper geometry captures are required");
    assert(record.root_inventory.status == "captured", ...
        "test_native_pdf_fixture_canvas:RootInventory", "The complete root inventory must be captured");
    record.status = "completed_diagnostic";
catch errorRecord
    record.status = "failed";
    record.error_identifier = string(errorRecord.identifier);
    record.error_message = string(errorRecord.message);
    if ~isempty(panelHandle) && isgraphics(panelHandle) && ~isempty(roots)
        record.restoration_attempted = true;
        try
            restore_roots(roots, rootState, figureHandle, originalChildren);
            delete(panelHandle);
            record.restoration_completed = true;
        catch restoreError
            record.restoration_error = string(restoreError.identifier) + ": " + string(restoreError.message);
        end
    end
end
write_json(recordPath, record);
close_figure(figureHandle);
end

function supported = supported_root(object)
supported = isa(object, "matlab.graphics.layout.TiledChartLayout") || isgraphics(object, "axes");
end

function state = root_state(object)
state = struct("Parent", get(object, "Parent"), "Units", get(object, "Units"), ...
    "Position", get(object, "Position"), "OuterPosition", get(object, "OuterPosition"), ...
    "PositionConstraint", get(object, "PositionConstraint"));
end

function restore_geometry(object, state)
set(object, "Units", state.Units);
set(object, "Position", state.Position);
set(object, "OuterPosition", state.OuterPosition);
set(object, "PositionConstraint", state.PositionConstraint);
if string(state.PositionConstraint) == "innerposition"
    set(object, "Position", state.Position);
else
    set(object, "OuterPosition", state.OuterPosition);
end
end

function restore_roots(roots, states, figureHandle, originalChildren)
for rootIndex = 1:numel(roots)
    assert(isgraphics(roots(rootIndex)), "test_native_pdf_fixture_canvas:DeletedRoot", ...
        "A source root was deleted before restoration");
    set(roots(rootIndex), "Parent", states{rootIndex}.Parent);
    restore_geometry(roots(rootIndex), states{rootIndex});
end
remaining = get(figureHandle, "Children");
extraChildren = remaining(~ismember(remaining, originalChildren));
set(figureHandle, "Children", [originalChildren(:); extraChildren(:)]);
end

function states = data_state(objects)
properties = ["XData" "YData" "ZData" "CData" "SizeData" "UData" "VData" ...
    "YNegativeDelta" "YPositiveDelta" "XNegativeDelta" "XPositiveDelta" ...
    "UserData" "Color" "LineStyle" "LineWidth" "Marker" "MarkerSize" ...
    "MarkerFaceColor" "MarkerEdgeColor" "MarkerFaceAlpha" "MarkerEdgeAlpha" ...
    "AlphaData" "AlphaDataMapping" "CDataMapping" "CLim" "CLimMode" "Colormap" ...
    "XLim" "YLim" "ZLim" "XLimMode" "YLimMode" "ZLimMode" ...
    "XDir" "YDir" "ZDir" "XScale" "YScale" "ZScale" ...
    "XTick" "YTick" "ZTick" "XTickMode" "YTickMode" "ZTickMode" ...
    "XTickLabel" "YTickLabel" "ZTickLabel" ...
    "DataAspectRatio" "DataAspectRatioMode" "PlotBoxAspectRatio" "PlotBoxAspectRatioMode" ...
    "Clipping" "FaceAlpha" "DisplayName" "CapSize" "String" "FontName" "FontSize" ...
    "FontUnits" "FontWeight" "FontAngle" "Interpreter" "Visible" "Rotation"];
states = cell(numel(objects), 1);
for objectIndex = 1:numel(objects)
    object = objects{objectIndex};
    assert(live_object(object), "test_native_pdf_fixture_canvas:DeletedObject", ...
        "An original graphics object no longer exists");
    state = struct();
    for property = properties
        if isprop(object, property)
            state.(property) = object.(property);
        end
    end
    states{objectIndex} = state;
end
end

function same = same_data(objects, before)
same = isequaln(data_state(objects), before);
end

function snapshot = geometry_state(objects)
snapshot = struct("status", "captured", "objects", struct([]), ...
    "error_identifier", "", "error_message", "");
properties = ["Units" "Position" "OuterPosition" "InnerPosition" "TightInset" ...
    "PositionConstraint" "FontName" "FontSize" "FontUnits" "FontWeight" ...
    "FontAngle" "String" "Extent" "Visible" "Interpreter" "Rotation" "Tag" ...
    "FaceColor" "EdgeColor" "Padding" "TileSpacing" "GridSize" ...
    "PaperUnits" "PaperPosition" "PaperSize" "PaperPositionMode" ...
    "BorderType" "BorderWidth" "HandleVisibility"];
try
    for objectIndex = 1:numel(objects)
        object = objects{objectIndex};
        assert(live_object(object), "test_native_pdf_fixture_canvas:DeletedGeometryObject", ...
            "An original graphics object no longer exists");
        record = struct("object_index", objectIndex, "class", string(class(object)), ...
            "parent_class", "", ...
            "properties", struct(), "unavailable_properties", strings(0, 1));
        if isprop(object, "Parent")
            record.parent_class = string(class(object.Parent));
        else
            record.unavailable_properties(end + 1, 1) = "Parent";
        end
        for property = properties
            if isprop(object, property)
                record.properties.(property) = object.(property);
            else
                record.unavailable_properties(end + 1, 1) = property;
            end
        end
        if isempty(snapshot.objects)
            snapshot.objects = record;
        else
            snapshot.objects(end + 1, 1) = record;
        end
    end
catch errorRecord
    snapshot.status = "capture_failed";
    snapshot.error_identifier = string(errorRecord.identifier);
    snapshot.error_message = string(errorRecord.message);
end
end

function objects = original_objects(root)
objects = num2cell(findall(root));
namedProperties = ["Title" "Subtitle" "XLabel" "YLabel" "ZLabel" "Label"];
objectIndex = 1;
while objectIndex <= numel(objects)
    owner = objects{objectIndex};
    for property = namedProperties
        if ~isprop(owner, property)
            continue;
        end
        candidate = owner.(property);
        if live_object(candidate) && ~any(cellfun(@(object) isequal(object, candidate), objects))
            objects{end + 1, 1} = candidate;
        end
    end
    objectIndex = objectIndex + 1;
end
end

function valid = live_object(object)
valid = isscalar(object) && (isgraphics(object) || (isa(object, "handle") && isvalid(object)));
end

function artifact = export_artifact(outputDirectory, artifact, target, kind)
filePath = fullfile(outputDirectory, artifact.file);
artifact.status = "failed";
try
    assert(~isfile(filePath), "test_native_pdf_fixture_canvas:StaleArtifact", ...
        "Refusing to overwrite %s", filePath);
    artifact.api_invoked = true;
    artifact.export_object_class = string(class(target));
    if kind == "canvas-pdf"
        exportgraphics(target, filePath, "ContentType", "vector", "BackgroundColor", "white");
    elseif kind == "reference-pdf"
        print(target, filePath, "-dpdf", "-painters");
    else
        print(target, filePath, "-dpng", "-r300");
    end
    artifact.call_succeeded = true;
    information = dir(filePath);
    assert(isscalar(information) && ~information.isdir && information.bytes > 0, ...
        "test_native_pdf_fixture_canvas:EmptyArtifact", "Export did not produce a nonempty file");
    artifact.bytes = information.bytes;
    artifact.sha256 = string(oi_sha256_file(filePath));
    if kind == "png"
        imageInfo = imfinfo(filePath);
        artifact.png_pixels = [imageInfo.Width imageInfo.Height];
    end
    artifact.status = "exported";
catch errorRecord
    artifact.error_identifier = string(errorRecord.identifier);
    artifact.error_message = string(errorRecord.message);
end
end

function assert_exports(record, names, outputDirectory)
for name = names
    assert(record.(name).status == "exported", ...
        "test_native_pdf_fixture_canvas:Export", "%s: %s", name, record.(name).error_message);
    artifact = record.(name);
    filePath = fullfile(outputDirectory, artifact.file);
    information = dir(filePath);
    assert(isscalar(information) && information.bytes == artifact.bytes ...
        && string(oi_sha256_file(filePath)) == artifact.sha256, ...
        "test_native_pdf_fixture_canvas:ArtifactChanged", "Artifact changed after export: %s", filePath);
    if endsWith(artifact.file, ".png")
        assert(isequal(artifact.png_pixels, [2400 1500]), ...
            "test_native_pdf_fixture_canvas:PNGDimensions", "PNG dimensions must remain 2400x1500");
    end
end
end

function write_json(filePath, payload)
fileHandle = fopen(filePath, "w", "n", "UTF-8");
assert(fileHandle >= 0, "test_native_pdf_fixture_canvas:Write", "Cannot write %s", filePath);
fileCleanup = onCleanup(@() fclose(fileHandle));
fprintf(fileHandle, "%s\n", jsonencode(payload));
clear fileCleanup;
end

function close_figure(figureHandle)
if isscalar(figureHandle) && isgraphics(figureHandle, "figure")
    delete(figureHandle);
end
end

function value = utc_time()
value = string(datetime("now", "TimeZone", "UTC", "Format", "yyyy-MM-dd'T'HH:mm:ss'Z'"));
end
