function test_font_available()
%TEST_FONT_AVAILABLE Check exact families and untrusted shell arguments.
testsDirectory = fileparts(mfilename("fullpath"));
originalMatlabPath = path;
pathCleanup = onCleanup(@() path(originalMatlabPath));
addpath(fullfile(fileparts(testsDirectory), "assets"));
assert(oi_font_available(" oi primary ", {"OI Primary", "Other"}));
assert(oi_font_available('OI Alternate', ["Other"; "OI Alternate"]));

invalidNames = {"", "   ", missing, strings(0, 1), ["One" "Two"], ...
    ['ab'; 'cd'], 42, {"OI Primary"}, "OI" + string(char(0)), ...
    "OI" + string(char(10)), "OI" + string(char(13)), ...
    "OI" + string(char(9)), "OI" + string(char(127))};
for nameIndex = 1:numel(invalidNames)
    assert(isequal(oi_font_available(invalidNames{nameIndex}, []), false));
end

if ~isunix
    assert(~oi_font_available("OI Missing Family", strings(0, 1)));
    fprintf("MATLAB_FONT_FONTCONFIG=skipped_non_unix\n");
    fprintf("MATLAB_FONT_AVAILABLE=passed\n");
    return;
end

temporaryDirectory = string(tempname);
mkdir(temporaryDirectory);
originalSystemPath = getenv("PATH");
cleanup = onCleanup(@() restore_environment(originalSystemPath, temporaryDirectory));
stubPath = fullfile(temporaryDirectory, "fc-match");
write_lines(stubPath, ["#!/bin/sh"; ...
    "printf '%s\n' ""$@"" > ""${0%/*}/arguments.txt"""; ...
    "cat ""${0%/*}/families.txt"""; ...
    "if [ -f ""${0%/*}/fail"" ]; then exit 1; fi"]);
assert(fileattrib(char(stubPath), '+x', 'u'));
setenv("PATH", char(temporaryDirectory + ":" + string(originalSystemPath)));
argumentsPath = fullfile(temporaryDirectory, "arguments.txt");
assert(oi_font_available("OI Primary", ["Other" "OI Primary"]));
assert(~isfile(argumentsPath), "Installed fonts must bypass fontconfig");
for nameIndex = 1:numel(invalidNames)
    assert(~oi_font_available(invalidNames{nameIndex}, []));
end
assert(~isfile(argumentsPath), "Invalid names must not invoke a shell");

familiesPath = fullfile(temporaryDirectory, "families.txt");
unicodeFamily = string(char([23383 20307]));
write_lines(familiesPath, ["Primary Family"; " Alias Family "; ...
    "Noto Sans CJK SC Extra"; "Vendor, Comma"; "Quote'Family"; ...
    "--help"; "Family:Bold-Regular\Quoted"; unicodeFamily]);
exactNames = ["Primary Family", " alias family ", "Vendor, Comma", ...
    "Quote'Family", "--help", "Family:Bold-Regular\Quoted", unicodeFamily];
for nameIndex = 1:numel(exactNames)
    assert(oi_font_available(exactNames(nameIndex), strings(0, 1)));
end
assert_query(argumentsPath, unicodeFamily);
assert(oi_font_available("Quote'Family", []));
assert_query(argumentsPath, "Quote'Family");
assert(oi_font_available("Family:Bold-Regular\Quoted", []));
assert_query(argumentsPath, "Family\:Bold\-Regular\\Quoted");
assert(oi_font_available("--help", []));
assert_query(argumentsPath, "\-\-help");
assert(oi_font_available("Vendor, Comma", []));
assert_query(argumentsPath, "Vendor\, Comma");

absentNames = ["Family", "Alias", "Noto Sans CJK SC", "Vendor", ...
    "Comma", "OI Missing Family", "Primary Family Extra"];
for nameIndex = 1:numel(absentNames)
    assert(~oi_font_available(absentNames(nameIndex), "Other"));
end
write_lines(familiesPath, "Unrelated Substitute");
assert(~oi_font_available("Primary Family", "Primary Family Extra"));

markerPath = fullfile(temporaryDirectory, "injected");
quotedMarker = "'" + replace(markerPath, "'", "'""'""'") + "'";
payloads = ["OI'; touch " + quotedMarker + "; #", ...
    "OI$(touch " + quotedMarker + ")", ...
    "OI`touch " + quotedMarker + "`", ...
    "OI""; touch " + quotedMarker + "; #", ...
    "OI$HOME & | < > ( ) * ? [ ] { } ! % ; ~"];
for payloadIndex = 1:numel(payloads)
    assert(~oi_font_available(payloads(payloadIndex), []));
    expectedPattern = replace(payloads(payloadIndex), "\", "\\");
    expectedPattern = replace(expectedPattern, ["-" ":" ","], ["\-" "\:" "\,"]);
    assert_query(argumentsPath, expectedPattern);
    assert(~isfile(markerPath), "Font name executed a shell command");
end

write_lines(familiesPath, "Primary Family");
write_lines(fullfile(temporaryDirectory, "fail"), "");
assert(~oi_font_available("Primary Family", []), ...
    "A failed query must not accept even exact output");
delete(fullfile(temporaryDirectory, "fail"));
write_lines(familiesPath, "");
assert(~oi_font_available("Primary Family", []));
emptyPath = fullfile(temporaryDirectory, "empty");
mkdir(emptyPath);
setenv("PATH", char(emptyPath));
assert(~oi_font_available("Primary Family", []), ...
    "Missing fontconfig must return false");
clear cleanup pathCleanup;
fprintf("MATLAB_FONT_AVAILABLE=passed\n");
end

function assert_query(argumentsPath, expectedPattern)
actual = string(fileread(argumentsPath));
expected = "-f" + newline + "%{[]family{%{family}\n}}" + newline ...
    + "--" + newline + expectedPattern + newline;
assert(actual == expected, "Fontconfig must receive one literal family pattern");
end

function write_lines(filePath, lines)
fileHandle = fopen(filePath, 'w', 'n', 'UTF-8');
assert(fileHandle >= 0, "Cannot create font test fixture");
cleanup = onCleanup(@() fclose(fileHandle));
fprintf(fileHandle, '%s\n', lines);
end

function restore_environment(originalPath, temporaryDirectory)
setenv("PATH", originalPath);
if isfolder(temporaryDirectory)
    rmdir(temporaryDirectory, "s");
end
end
