function report = test_display_rendering(expectedRelease, outputDirectory)
arguments
    expectedRelease (1,1) string
    outputDirectory (1,1) string
end
assert(~exist('OCTAVE_VERSION', 'builtin') && license('test', 'MATLAB') == 1, ...
    "test_display_rendering:MatlabRequired", "Licensed MathWorks MATLAB is required");
assert("R" + string(version('-release')) == expectedRelease, ...
    "test_display_rendering:Release", "Unexpected MATLAB release");
assert(strlength(string(getenv("DISPLAY"))) > 0, ...
    "test_display_rendering:Display", "A virtual X display is required for this control");
assert(~isfolder(outputDirectory) && ~isfile(outputDirectory), ...
    "test_display_rendering:FreshOutput", "Display diagnostics must use a fresh directory");
mkdir(outputDirectory);
addpath(fileparts(mfilename("fullpath")));
report = struct("schema_version", 1, "scope", "virtual_display_diagnostics_only", ...
    "started_at", string(datetime("now", "TimeZone", "UTC", "Format", "yyyy-MM-dd'T'HH:mm:ss'Z'")), ...
    "release", expectedRelease, "version", string(version), ...
    "display", string(getenv("DISPLAY")), "jvm_available", logical(usejava("jvm")), ...
    "desktop_available", logical(usejava("desktop")), ...
    "screen_pixels_per_inch", get(groot, "ScreenPixelsPerInch"), ...
    "visual_verified", false, "desktop_interaction_verified", false, "status", "running");
template = struct("id", "", "status", "pending", "error_identifier", "", "error_message", "");
report.cases = repmat(template, 3, 1);
identifiers = ["publication", "native-pdf-page-probe", "vector-text-alignment-probe"];
callbacks = {@() run_publication_diagnostics(outputDirectory), ...
    @() test_native_pdf_page_probe(fullfile(outputDirectory, "native-pdf-page-probe")), ...
    @() test_vector_text_alignment(fullfile(outputDirectory, "vector-text-alignment-probe"))};
reportPath = fullfile(outputDirectory, "display-rendering.json");
for index = 1:3
    report.cases(index).id = identifiers(index);
end
write_report(reportPath, report);
for index = 1:3
    report.cases(index).status = "running";
    write_report(reportPath, report);
    try
        callbacks{index}();
        report.cases(index).status = "export_checks_completed";
    catch errorDetails
        report.cases(index).status = "failed";
        report.cases(index).error_identifier = string(errorDetails.identifier);
        report.cases(index).error_message = string(errorDetails.message);
    end
    write_report(reportPath, report);
end
report.failed_count = nnz([report.cases.status] == "failed");
report.completed_at = string(datetime("now", "TimeZone", "UTC", "Format", "yyyy-MM-dd'T'HH:mm:ss'Z'"));
report.status = "completed_pending_external_review";
if report.failed_count > 0
    report.status = "completed_with_failures";
end
write_report(reportPath, report);
fprintf("MATLAB_DISPLAY_DIAGNOSTICS=%s\n", reportPath);
assert(report.failed_count == 0, "test_display_rendering:FailedCases", ...
    "Virtual-display export checks failed; partial diagnostic files are retained");
end

function run_publication_diagnostics(outputDirectory)
diagnose_svg_print_sizes(fullfile(outputDirectory, "svg-print-sizes-probe"));
full100_export_contracts(fullfile(outputDirectory, "publication"), true);
end

function write_report(filePath, report)
fileHandle = fopen(char(filePath), "w", "n", "UTF-8");
assert(fileHandle >= 0, "test_display_rendering:Write", "Cannot write diagnostic JSON");
cleanup = onCleanup(@() fclose(fileHandle));
fprintf(fileHandle, "%s\n", jsonencode(report));
end
