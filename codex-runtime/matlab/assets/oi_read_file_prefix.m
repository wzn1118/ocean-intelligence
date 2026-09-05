function prefix = oi_read_file_prefix(filePath, maximumBytes)
%OI_READ_FILE_PREFIX Read at most maximumBytes without text decoding.
% Input contract: filePath names an existing nonempty regular file and
% maximumBytes is a positive integer. The returned value is a uint8 column.
arguments
    filePath (1,1) string
    maximumBytes (1,1) double {mustBeInteger,mustBePositive}
end
assert(~ismissing(filePath) && strlength(strtrim(filePath)) > 0 ...
    && isfile(filePath), "oi_read_file_prefix:MissingFile", ...
    "filePath must name an existing file");
fileInfo = dir(filePath);
assert(~isempty(fileInfo) && fileInfo.bytes > 0, ...
    "oi_read_file_prefix:EmptyFile", "Cannot read an empty file");
fileHandle = fopen(filePath, "rb");
assert(fileHandle >= 0, "oi_read_file_prefix:ReadFailed", ...
    "Cannot read %s", filePath);
cleanup = onCleanup(@() fclose(fileHandle));
prefix = fread(fileHandle, maximumBytes, "*uint8");
clear cleanup;
end
