function test_remaining_plot_families
testDirectory = fileparts(mfilename("fullpath"));
matlabDirectory = fileparts(testDirectory);
addpath(fullfile(matlabDirectory,"assets"));

theme = oi_ocean_theme();
test_profile_contract(theme);
test_section_contract(theme);
test_hovmoller_contract(theme);
test_spectrum_contract(theme);
test_vector_sampling_contract(theme);
test_comparison_uncertainty_indexing(theme);
disp("MATLAB_REMAINING_PLOT_FAMILIES=ok");
end

function test_profile_contract(theme)
[figureHandle,axesHandle,cleanup] = make_axes();
options = struct("DepthUnit","m","VerticalReference","sea surface", ...
    "QuantityLabel","Temperature","QuantityUnit","degC", ...
    "UncertaintyValues",[0.1;0.1;NaN], ...
    "UncertaintyType","standard-deviation","UncertaintyUnit","degC", ...
    "Theme",theme);
result = oi_plot_profile(axesHandle,[0;10;20],[12;11;NaN],options);
assert(string(axesHandle.YDir) == "reverse" && result.ValidCount == 2 ...
    && result.MissingCount == 1,"Profile direction or mask accounting failed");
badOptions = options;
badOptions.UncertaintyUnit = "K";
must_throw(@() oi_plot_profile(axesHandle,[0;10;20],[12;11;NaN],badOptions), ...
    "UncertaintyUnit");
clear cleanup;
close_if_valid(figureHandle);
end

function test_section_contract(theme)
[figureHandle,axesHandle,cleanup] = make_axes();
field = [12 11 10;9 NaN 8];
structuralMask = false(size(field));
structuralMask(2,2) = true;
options = struct("DistanceUnit","km","DepthUnit","m", ...
    "QuantityLabel","Temperature","QuantityUnit","degC", ...
    "ColorLimits",[8 12],"StructuralMissingMask",structuralMask, ...
    "ReportingMissingMask",false(size(field)),"Theme",theme);
result = oi_plot_section(axesHandle,[0 10 20],[0;50],field,options);
assert(string(axesHandle.YDir) == "reverse" && result.StructuralMissingCount == 1 ...
    && result.ReportingMissingCount == 0 && ~result.Interpolated, ...
    "Section orientation or missing classification failed");
clear cleanup;
close_if_valid(figureHandle);
end

function test_hovmoller_contract(theme)
[figureHandle,axesHandle,cleanup] = make_axes();
time = datetime(2026,9,5,0:2,0,0,"TimeZone","UTC")';
field = [12 NaN 11;10 9 8];
options = struct("DepthUnit","m","QuantityLabel","Temperature", ...
    "QuantityUnit","degC","ColorLimits",[8 12],"Theme",theme);
result = oi_plot_hovmoller(axesHandle,time,[0;50],field,options);
assert(string(axesHandle.YDir) == "reverse" && result.MissingCount == 1 ...
    && isequal(logical(result.Image.AlphaData),isfinite(field)) ...
    && result.TimeZone == "UTC","Hovmoller orientation or alpha mask failed");
clear cleanup;
close_if_valid(figureHandle);
end

function test_spectrum_contract(theme)
[figureHandle,axesHandle,cleanup] = make_axes();
options = struct("FrequencyUnit","Hz","PeriodUnit","s", ...
    "DensityUnit","m^2/Hz","WindowDescription","precomputed upstream", ...
    "DetrendDescription","mean removed upstream", ...
    "SegmentDescription","two finite segments","Theme",theme);
result = oi_plot_spectrum(axesHandle,[0.1;0.2;0.4;0.8],[4;2;NaN;0.5],options);
assert(string(axesHandle.XScale) == "log" && string(axesHandle.YScale) == "log" ...
    && result.MissingCount == 1 && result.BoundStatus == "absent", ...
    "Spectrum logarithmic or NaN-gap contract failed");
clear cleanup;
close_if_valid(figureHandle);
end

function test_vector_sampling_contract(theme)
[figureHandle,axesHandle,cleanup] = make_axes();
options = struct("XUnit","km","YUnit","km","VectorUnit","m/s", ...
    "ComponentFrame","east/north","XLabel","East","YLabel","North", ...
    "Stride",2,"Theme",theme);
u = [NaN NaN NaN;NaN 1 NaN;NaN NaN NaN];
v = u;
must_throw(@() oi_plot_vector_field(axesHandle,[0 1 2],[0;1;2],u,v,options), ...
    "NoSampledVectors");
options.Stride = 1;
result = oi_plot_vector_field(axesHandle,[0 1 2],[0;1;2],u,v,options);
assert(result.SampledValidCount == 1 && result.ValidCount == 1, ...
    "Vector sampled-mask accounting failed");
clear cleanup;
close_if_valid(figureHandle);
end

function test_comparison_uncertainty_indexing(theme)
[figureHandle,axesHandle,cleanup] = make_axes();
options = struct("QuantityUnit","degC", ...
    "ObservationUncertainty",[NaN;0.1;0.2], ...
    "ModelUncertainty",[NaN;0.2;0.1], ...
    "UncertaintyType","standard-deviation","UncertaintyUnit","degC", ...
    "Theme",theme);
result = oi_plot_comparison(axesHandle,[NaN;1;2],[NaN;1.1;1.9],options);
assert(result.ValidCount == 2 && numel(result.UncertaintyGraphics) == 4, ...
    "Comparison uncertainty graphics must follow original paired indices");
assert(isequal(result.UncertaintyGraphics(2).XData,[1 1]) ...
    && isequal(result.UncertaintyGraphics(4).XData,[2 2]), ...
    "Comparison vertical uncertainty bars were attached to wrong samples");
clear cleanup;
close_if_valid(figureHandle);
end

function [figureHandle,axesHandle,cleanup] = make_axes
figureHandle = figure("Visible","off");
axesHandle = axes("Parent",figureHandle);
cleanup = onCleanup(@() close_if_valid(figureHandle));
end

function must_throw(callback,identifierFragment)
thrown = false;
try
    callback();
catch exception
    thrown = contains(string(exception.identifier),identifierFragment);
end
assert(thrown,"Expected an error identifier containing " + identifierFragment);
end

function close_if_valid(figureHandle)
if isgraphics(figureHandle)
    close(figureHandle);
end
end
