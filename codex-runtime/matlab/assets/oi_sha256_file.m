function digest = oi_sha256_file(filePath)
%OI_SHA256_FILE Return a stable lowercase SHA-256 digest.
% Input contract: filePath names an existing nonempty regular file and the
% authoritative MATLAB runtime can use the JVM MessageDigest provider or a
% system sha256sum fallback. File bytes are never text-decoded or mutated.
arguments
    filePath (1,1) string
end
assert(~ismissing(filePath) && strlength(strtrim(filePath)) > 0 ...
    && isfile(filePath), "oi_sha256_file:MissingFile", ...
    "filePath must name an existing file");
before = dir(filePath);
assert(isscalar(before) && before.bytes > 0 && ~before.isdir, ...
    "oi_sha256_file:EmptyFile", "Cannot hash an empty file");
if ~usejava("jvm")
    digest = system_sha256(filePath);
    after = dir(filePath);
    assert(isscalar(after) && ~after.isdir && after.bytes == before.bytes ...
        && after.datenum == before.datenum, "oi_sha256_file:FileChanged", ...
        "File changed while its SHA-256 digest was being computed: %s", filePath);
    return;
end
engine = java.security.MessageDigest.getInstance("SHA-256");
fileHandle = fopen(filePath, "rb");
assert(fileHandle >= 0, "oi_sha256_file:ReadFailed", "Cannot read %s", filePath);
cleanup = onCleanup(@() fclose(fileHandle));
byteCount = 0;
while true
    bytes = fread(fileHandle, [1 1048576], "*uint8");
    if isempty(bytes)
        break;
    end
    engine.update(bytes);
    byteCount = byteCount + numel(bytes);
end
assert(feof(fileHandle), "oi_sha256_file:ReadFailed", ...
    "Could not read the complete file: %s", filePath);
digest = lower(reshape(dec2hex(typecast(engine.digest(), "uint8"))', 1, []));
clear cleanup;
after = dir(filePath);
assert(isscalar(after) && ~after.isdir && byteCount == before.bytes ...
    && after.bytes == before.bytes && after.datenum == before.datenum, ...
    "oi_sha256_file:FileChanged", ...
    "File changed while its SHA-256 digest was being computed: %s", filePath);
end

function digest = system_sha256(filePath)
quotedPath = "'" + replace(filePath, "'", "'\"'\"'") + "'";
[status, output] = system("sha256sum -- " + quotedPath);
assert(status == 0, "oi_sha256_file:JVMRequired", ...
    "SHA-256 requires either the MATLAB JVM or a working sha256sum command");
tokens = regexp(strtrim(output), "^([0-9A-Fa-f]{64})\\s", "tokens", "once");
assert(~isempty(tokens), "oi_sha256_file:InvalidDigest", ...
    "sha256sum returned an invalid digest");
digest = lower(string(tokens{1}));
end
