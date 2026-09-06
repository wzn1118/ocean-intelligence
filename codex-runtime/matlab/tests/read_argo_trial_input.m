function expected = read_argo_trial_input(inputPath)
arguments
    inputPath (1,1) string
end
fileHandle = fopen(inputPath, 'rb');
assert(fileHandle >= 0, 'argo_native_probe:InputRead', 'Cannot read the original input');
cleanup = onCleanup(@() fclose(fileHandle));
rawBytes = fread(fileHandle, Inf, '*uint8').';
assert(feof(fileHandle), 'argo_native_probe:InputRead', 'Incomplete original input read');
rawText = native2unicode(rawBytes, 'UTF-8');
clear cleanup;
profiles = jsondecode(rawText);
counts = [595; 596; 594];
profileIDs = ["4903822_067"; "4903822_066"; "4903822_065"];
names = ["pressure"; "pressure_argoqc"; "salinity"; ...
    "salinity_argoqc"; "temperature"; "temperature_argoqc"];
assert(isstruct(profiles) && numel(profiles) == 3, ...
    'argo_native_probe:InputShape', 'Expected the three original profiles');
values = zeros(sum(counts), 6);
profileIndex = zeros(sum(counts), 1);
levelIndex = zeros(sum(counts), 1);
utcTimes = NaT(3, 1, 'TimeZone', 'UTC');
coordinates = zeros(3, 2);
offset = 0;
for profileNumber = 1:3
    profile = profiles(profileNumber);
    assert(string(profile.(matlab.lang.makeValidName('_id'))) == profileIDs(profileNumber), ...
        'argo_native_probe:InputOrder', 'Profile order or identity changed');
    assert(isequal(string(profile.data_info{1}(:)), names), ...
        'argo_native_probe:Variables', 'Variable names/order differ from the bound input');
    assert(isnumeric(profile.data) ...
        && isequal(size(profile.data), [6 counts(profileNumber)]), ...
        'argo_native_probe:DecodedShape', 'Expected JSON variable-by-level numeric arrays');
    selected = offset + (1:counts(profileNumber));
    values(selected, :) = profile.data.';
    profileIndex(selected) = profileNumber;
    levelIndex(selected) = (1:counts(profileNumber)).';
    utcTimes(profileNumber) = datetime(profile.timestamp, ...
        'InputFormat', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", 'TimeZone', 'UTC');
    coordinates(profileNumber, :) = profile.geolocation.coordinates(:).';
    assert(~isnat(utcTimes(profileNumber)) && all(isfinite(coordinates(profileNumber, :))), ...
        'argo_native_probe:Coordinates', 'Original UTC/lon/lat must remain valid');
    offset = offset + counts(profileNumber);
end
assert(all(isfinite(values(:))) && all(all(values(:, [2 4 6]) == 1)), ...
    'argo_native_probe:InputValues', 'This pinned input has finite values and QC=1');
expected = struct('Values', values, 'ProfileIndex', profileIndex, ...
    'LevelIndex', levelIndex, 'ProfileMetadata', rmfield(profiles, 'data'), ...
    'VariableOrder', names, 'ProfileIDs', profileIDs, 'ProfileCounts', counts, ...
    'UTCTimes', utcTimes, 'LongitudeLatitude', coordinates);
expected.RawJSONText = string(rawText);
expected.RawBytes = rawBytes;
expected.Records = expected_records(expected);
expected.RecordVariableNames = string(fieldnames(expected.Records));
expected.RecordVariableUnits = repmat("", numel(expected.RecordVariableNames), 1);
unitVariables = ["pressure", "temperature", "salinity", "Longitude", "Latitude"];
unitValues = ["decibar", "degree_Celsius", "psu", "degrees_east", "degrees_north"];
for unitIndex = 1:numel(unitVariables)
    expected.RecordVariableUnits(expected.RecordVariableNames == unitVariables(unitIndex)) = unitValues(unitIndex);
end
end

function records = expected_records(expected)
profileIndex = expected.ProfileIndex;
levels = expected.LevelIndex;
profileIDs = expected.ProfileIDs(profileIndex);
times = expected.UTCTimes;
times.Format = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
timeText = string({expected.ProfileMetadata.timestamp}).';
records = struct('ObservationID', profileIDs + ":layer:" + compose("%04d", levels), ...
    'ProfileID', profileIDs, 'PlatformID', extractBefore(profileIDs, "_"), ...
    'ProfileIndex', profileIndex, 'SourceRow', levels, 'SourceFileRow', (1:1785).', ...
    'Time', string(times(profileIndex)), 'TimeText', timeText(profileIndex), ...
    'Longitude', expected.LongitudeLatitude(profileIndex, 1), ...
    'Latitude', expected.LongitudeLatitude(profileIndex, 2), ...
    'pressure', expected.Values(:, 1), 'temperature', expected.Values(:, 5), ...
    'salinity', expected.Values(:, 3), 'pressure_argoqc', expected.Values(:, 2), ...
    'temperature_argoqc', expected.Values(:, 6), 'salinity_argoqc', expected.Values(:, 4), ...
    'PressureMode', strings(1785, 1), 'TemperatureMode', strings(1785, 1), ...
    'SalinityMode', strings(1785, 1), 'PressureUnit', strings(1785, 1), ...
    'TemperatureUnit', strings(1785, 1), 'SalinityUnit', strings(1785, 1), ...
    'ProfileDirection', strings(1785, 1), 'PositionQC', zeros(1785, 1), ...
    'TimeQC', zeros(1785, 1), 'Series', "Profile: " + profileIDs);
unitFields = {'PressureUnit', 'SalinityUnit', 'TemperatureUnit'};
modeFields = {'PressureMode', 'SalinityMode', 'TemperatureMode'};
quantityRows = [1 3 5];
for profileNumber = 1:3
    profile = expected.ProfileMetadata(profileNumber);
    selected = profileIndex == profileNumber;
    records.ProfileDirection(selected) = string(profile.profile_direction);
    records.PositionQC(selected) = profile.geolocation_argoqc;
    records.TimeQC(selected) = profile.timestamp_argoqc;
    for quantityIndex = 1:3
        metadata = profile.data_info{3};
        if isequal(size(metadata), [6 2])
            pair = metadata(quantityRows(quantityIndex), :);
        else
            assert(iscell(metadata) && isvector(metadata) && numel(metadata) == 6, ...
                'argo_native_probe:MetadataShape', 'Expected six original unit/mode pairs');
            pair = metadata{quantityRows(quantityIndex)};
        end
        assert(iscell(pair) && numel(pair) == 2, ...
            'argo_native_probe:MetadataShape', 'Quantity metadata must retain its two text entries');
        records.(unitFields{quantityIndex})(selected) = string(pair{1});
        records.(modeFields{quantityIndex})(selected) = string(pair{2});
    end
end
end
