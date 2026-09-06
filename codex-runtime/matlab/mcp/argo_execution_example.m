projectRoot = string(getenv('MATLAB_PROJECT_ROOT'));
outputRoot = string(getenv('MATLAB_OUTPUT_DIR'));
assert(isfolder(projectRoot) && isfolder(outputRoot), ...
    'ocean_mcp_example:Environment', 'The execution tool must supply project and output directories');
addpath(fullfile(projectRoot, 'codex-runtime', 'matlab', 'tests'));
addpath(fullfile(projectRoot, 'codex-runtime', 'matlab', 'assets'));
inputPath = fullfile(projectRoot, 'codex-runtime', 'matlab', 'tests', ...
    'model-generated-round24', 'argo-4903822-30d.json');
inputHash = oi_sha256_file(inputPath);
assert(strcmp(inputHash, '33959a0d9296cf3d0739375d0d551550d493dddbe3aa8cc3606b67ac7df0b7fa'), ...
    'ocean_mcp_example:InputBinding', 'The original Argo input hash changed');
observations = read_argo_trial_input(inputPath);
temperature = observations.Values(:, 5);
salinity = observations.Values(:, 3);
pressure = observations.Values(:, 1);
assert(numel(temperature) == 1785 && all(isfinite(observations.Values(:))), ...
    'ocean_mcp_example:RecordCount', 'Expected all 1785 original layers');
assert(abs(mean(temperature) - 1.281584873949580) < 1e-12, ...
    'ocean_mcp_example:Statistics', 'MATLAB mean differs from the independent decimal reference');
statisticsResult = struct('runtime', 'MATLAB', 'matlab_release', "R" + string(version('-release')), ...
    'input_sha256', inputHash, 'platform_count', 1, 'profile_count', 3, 'layer_count', 1785, ...
    'profile_ids', observations.ProfileIDs, 'profile_layer_counts', observations.ProfileCounts, ...
    'variables', ["temperature", "salinity", "pressure"], ...
    'units', ["degree_Celsius", "psu", "decibar"], ...
    'mean', [mean(temperature), mean(salinity), mean(pressure)], ...
    'population_standard_deviation', [std(temperature, 1), std(salinity, 1), std(pressure, 1)], ...
    'minimum', [min(temperature), min(salinity), min(pressure)], ...
    'maximum', [max(temperature), max(salinity), max(pressure)], ...
    'weighting', 'equal weight per sampled layer; not area, volume or time weighting', ...
    'limitations', 'One platform and three discrete profiles; pressure is not depth. No climate trend, uncertainty estimate or independent upstream authentication.');
resultHandle = fopen(fullfile(outputRoot, 'argo-statistics.json'), 'w', 'n', 'UTF-8');
assert(resultHandle >= 0, 'ocean_mcp_example:Output', 'Cannot create the numeric result');
fprintf(resultHandle, '%s\n', jsonencode(statisticsResult));
fclose(resultHandle);

figureHandle = figure('Visible', 'off', 'Color', 'white', ...
    'Units', 'inches', 'Position', [1 1 12 6.5]);
layoutHandle = tiledlayout(figureHandle, 1, 3, 'Padding', 'loose', 'TileSpacing', 'loose');
profileColors = [0.04 0.46 0.43; 0.72 0.27 0.22; 0.35 0.39 0.58];
profileDates = observations.UTCTimes;
profileDates.Format = 'yyyy-MM-dd';
temperatureAxes = nexttile(layoutHandle);
hold(temperatureAxes, 'on');
for profileNumber = 1:3
    selected = observations.ProfileIndex == profileNumber;
    plot(temperatureAxes, temperature(selected), pressure(selected), ...
        'Color', profileColors(profileNumber, :), 'LineWidth', 1.3, ...
        'DisplayName', string(profileDates(profileNumber)));
end
set(temperatureAxes, 'YDir', 'reverse');
xlabel(temperatureAxes, 'Temperature (degree Celsius)', 'Interpreter', 'none');
ylabel(temperatureAxes, 'Pressure (decibar)', 'Interpreter', 'none');
title(temperatureAxes, 'Temperature profiles');
legend(temperatureAxes, 'Location', 'southoutside', 'Box', 'off');

salinityAxes = nexttile(layoutHandle);
hold(salinityAxes, 'on');
for profileNumber = 1:3
    selected = observations.ProfileIndex == profileNumber;
    plot(salinityAxes, salinity(selected), pressure(selected), ...
        'Color', profileColors(profileNumber, :), 'LineWidth', 1.3);
end
set(salinityAxes, 'YDir', 'reverse');
xlabel(salinityAxes, 'Salinity (psu)', 'Interpreter', 'none');
ylabel(salinityAxes, 'Pressure (decibar)', 'Interpreter', 'none');
title(salinityAxes, 'Salinity profiles');

relationshipAxes = nexttile(layoutHandle);
pointHandle = scatter(relationshipAxes, salinity, temperature, 12, pressure, 'filled');
pointHandle.UserData = struct('ObservationID', observations.Records.ObservationID, ...
    'SourceFileRow', observations.Records.SourceFileRow);
xlabel(relationshipAxes, 'Salinity (psu)', 'Interpreter', 'none');
ylabel(relationshipAxes, 'Temperature (degree Celsius)', 'Interpreter', 'none');
title(relationshipAxes, 'Temperature-salinity');
colormap(relationshipAxes, parula(256));
pressureScale = colorbar(relationshipAxes, 'Location', 'southoutside');
pressureScale.Label.String = 'Pressure (decibar)';
allAxes = [temperatureAxes, salinityAxes, relationshipAxes];
set(allAxes, 'FontName', 'DejaVu Sans', 'FontSize', 10, ...
    'Box', 'off', 'XGrid', 'on', 'YGrid', 'on', 'GridAlpha', 0.12);
title(layoutHandle, 'Argo 4903822 | 3 profiles | 1785 sampled layers', ...
    'FontName', 'DejaVu Sans', 'FontSize', 15, 'FontWeight', 'bold');
drawnow;
exportgraphics(layoutHandle, fullfile(outputRoot, 'argo-profiles.png'), 'Resolution', 200);
exportgraphics(layoutHandle, fullfile(outputRoot, 'argo-profiles.pdf'), 'ContentType', 'vector');
close(figureHandle);
fprintf('MATLAB_MCP_ARGO_LAYERS=%d\n', numel(temperature));
fprintf('MATLAB_MCP_ARGO_TEMPERATURE_MEAN=%.15f\n', mean(temperature));
