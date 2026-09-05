function cleanup = oi_hold_axes(axesHandle)
%OI_HOLD_AXES Enable additive plotting and return deterministic restoration.
% Input contract: axesHandle is a live traditional MATLAB axes. Clearing or
% destroying the returned onCleanup restores the caller's original NextPlot
% state when the axes still exists.
arguments
    axesHandle (1,1) matlab.graphics.axis.Axes
end
originalNextPlot = axesHandle.NextPlot;
cleanup = onCleanup(@() restore_next_plot(axesHandle, originalNextPlot));
hold(axesHandle, "on");
end

function restore_next_plot(axesHandle, originalNextPlot)
if isgraphics(axesHandle) && isprop(axesHandle, "NextPlot")
    axesHandle.NextPlot = originalNextPlot;
end
end
