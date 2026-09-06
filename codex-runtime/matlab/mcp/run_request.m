function run_request(executionRoot)
arguments
    executionRoot (1,1) string
end
mcpDirectory = fileparts(mfilename("fullpath"));
projectRoot = fileparts(fileparts(fileparts(mcpDirectory)));
assetDirectory = fullfile(projectRoot, "codex-runtime", "matlab", "assets");
originalPath = path;
originalDirectory = pwd;
cleanup = onCleanup(@() restore_context(originalPath, originalDirectory));
addpath(assetDirectory);
receiptPath = fullfile(executionRoot, "execution.json");
receipt = read_json(receiptPath);
failure = [];
try
    receipt.matlab_started = true;
    receipt.started_at = utc_time();
    receipt.matlab_release = "R" + string(version('-release'));
    receipt.matlab_version = string(version);
    receipt.status = "running";
    products = ver;
    receipt.installed_products = cell(numel(products), 1);
    for productIndex = 1:numel(products)
        receipt.installed_products{productIndex} = struct( ...
            "name", string(products(productIndex).Name), ...
            "version", string(products(productIndex).Version), ...
            "release", string(products(productIndex).Release));
    end
    diaryPath = fullfile(executionRoot, "diary.log");
    diary(char(diaryPath));
    write_json(receiptPath, receipt);
    request = read_json(fullfile(executionRoot, "request.json"));
    assert(string(receipt.matlab_release) == string(request.requested_release), ...
        "MATLABExecution:ReleaseMismatch", "Actual MATLAB release differs from the requested release");
    assert(strcmp(which("oi_sha256_file"), char(fullfile(assetDirectory, "oi_sha256_file.m"))), ...
        "MATLABExecution:HelperPath", "Expected the repository SHA-256 helper");
    codePath = fullfile(executionRoot, "code.m");
    outputDirectory = fullfile(executionRoot, "outputs");
    scriptPath = fullfile(outputDirectory, "request_code.m");
    codeBytes = read_bytes(codePath);
    assert(numel(codeBytes) == request.code_bytes ...
        && strcmp(oi_sha256_file(codePath), request.code_sha256) ...
        && isequal(read_bytes(scriptPath), codeBytes), ...
        "MATLABExecution:CodeBinding", "Executable script must match the prepared request bytes");
    if request.input_provided
        inputPath = fullfile(outputDirectory, "input.json");
        inputBytes = read_bytes(inputPath);
        assert(numel(inputBytes) == request.input_bytes ...
            && strcmp(oi_sha256_file(inputPath), request.input_sha256), ...
            "MATLABExecution:InputBinding", "Input JSON must match the prepared request bytes");
    end
    setenv("MATLAB_OUTPUT_DIR", outputDirectory);
    setenv("MATLAB_PROJECT_ROOT", projectRoot);
    cd(outputDirectory);
    receipt.code_started = true;
    write_json(receiptPath, receipt);
    evalin('base', 'run(''request_code.m'');');
    receipt.code_completed = true;
    assert(isequal(read_bytes(codePath), codeBytes) && isequal(read_bytes(scriptPath), codeBytes), ...
        "MATLABExecution:CodeChanged", "Request code changed during execution");
    if request.input_provided
        assert(isequal(read_bytes(inputPath), inputBytes), ...
            "MATLABExecution:InputChanged", "Input JSON changed during execution");
    end
    receipt.status = "succeeded";
catch errorRecord
    failure = errorRecord;
    receipt.status = "failed";
    receipt.error = exception_record(errorRecord);
    fprintf(2, "%s\n", getReport(errorRecord, "extended", "hyperlinks", "off"));
end
diary off;
receipt.finished_at = utc_time();
receipt.analysis_verified = false;
receipt.visual_verified = false;
receipt.toolbox_license_verified = false;
write_json(receiptPath, receipt);
clear cleanup;
if ~isempty(failure)
    rethrow(failure);
end
end

function bytes = read_bytes(filePath)
fileHandle = fopen(filePath, "rb");
assert(fileHandle >= 0, "MATLABExecution:Read", "Cannot read required execution file");
cleanup = onCleanup(@() fclose(fileHandle));
bytes = fread(fileHandle, Inf, "*uint8");
assert(feof(fileHandle), "MATLABExecution:Read", "Incomplete execution file read");
clear cleanup;
end

function value = read_json(filePath)
bytes = read_bytes(filePath);
value = jsondecode(native2unicode(bytes', 'UTF-8'));
end

function write_json(filePath, value)
bytes = unicode2native(jsonencode(value), 'UTF-8');
fileHandle = fopen(filePath, "wb");
assert(fileHandle >= 0, "MATLABExecution:ReceiptWrite", "Cannot write execution receipt");
cleanup = onCleanup(@() fclose(fileHandle));
assert(fwrite(fileHandle, bytes, "uint8") == numel(bytes), ...
    "MATLABExecution:ReceiptWrite", "Incomplete execution receipt write");
clear cleanup;
end

function value = utc_time()
value = string(datetime("now", "TimeZone", "UTC", "Format", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"));
end

function value = exception_record(errorRecord)
value = struct("identifier", string(errorRecord.identifier), ...
    "message", string(errorRecord.message));
value.stack = errorRecord.stack;
end

function restore_context(originalPath, originalDirectory)
path(originalPath);
if isfolder(originalDirectory)
    cd(originalDirectory);
end
end
