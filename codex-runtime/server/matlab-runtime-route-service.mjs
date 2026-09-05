import { resolveMatlabPlotRequest } from './matlab-plot-router.mjs';
import { buildMatlabRuntimeCiMatrix } from './matlab-release-capabilities.mjs';
import {
  buildMatlabOutputContract,
  buildMatlabPublicationContract,
  buildMatlabScientificDataContract,
  isMatlabJsonObject,
  matlabTaskRoutingFieldsPresent,
  rejectMatlabTaskRequest,
  routeMatlabTask,
} from './matlab-task-routing-contract.mjs';

export function routeMatlabRuntimeRequest(input = {}) {
  if (!isMatlabJsonObject(input)) return withRuntimeCi(routeMatlabTask(input));
  const hasPlotInput = Object.hasOwn(input, 'plotInput');
  const hasPlotAlias = Object.hasOwn(input, 'plot');
  if (hasPlotInput && hasPlotAlias) {
    return withRuntimeCi(rejectMatlabTaskRequest(input, 'plotInput and plot are mutually exclusive request aliases.',
      'Provide plot metadata in plotInput only, or use the legacy plot alias by itself.'));
  }
  if (!hasPlotInput && !hasPlotAlias) return withRuntimeCi(routeMatlabTask(input), input);

  const plotField = hasPlotInput ? 'plotInput' : 'plot';
  const plotInput = isMatlabJsonObject(input[plotField]) ? input[plotField] : null;
  if (!plotInput) {
    return withRuntimeCi(rejectMatlabTaskRequest(input, `${plotField} must be a JSON object.`,
      `Replace ${plotField} with one JSON object containing only plot metadata.`), input);
  }
  const nestedRoutingFields = matlabTaskRoutingFieldsPresent(plotInput);
  if (nestedRoutingFields.length) {
    return withRuntimeCi(rejectMatlabTaskRequest(input,
      `${plotField} must not contain task routing fields: ${nestedRoutingFields.join(', ')}.`,
      'Keep runtime, release, task, toolbox, contract, and output fields at the request top level.'), input);
  }
  const duplicateFields = Object.keys(plotInput).filter((name) => Object.hasOwn(input, name));
  if (duplicateFields.length) {
    return withRuntimeCi(rejectMatlabTaskRequest(input,
      `Top-level request fields conflict with ${plotField}: ${duplicateFields.join(', ')}.`,
      `Keep each plot metadata field in one place, preferably ${plotField}.`), input);
  }

  const routeInput = { ...input };
  delete routeInput.plotInput;
  delete routeInput.plot;
  const request = { ...routeInput, ...plotInput };
  const resolved = resolveMatlabPlotRequest(request);
  return withRuntimeCi(Object.freeze({
    ...resolved,
    scientificDataContract: resolved.taskRoute?.scientificDataContract || buildMatlabScientificDataContract(request, {
      active: true,
    }),
    publicationContract: resolved.taskRoute?.publicationContract || buildMatlabPublicationContract(request, {
      active: true,
    }),
    outputContract: resolved.taskRoute?.outputContract || buildMatlabOutputContract(request),
    qualityGate: resolved.taskRoute?.qualityGate || null,
  }), input);
}

function withRuntimeCi(result, input = {}) {
  const productionRelease = isMatlabJsonObject(input) && typeof input.productionRelease === 'string'
    ? input.productionRelease
    : undefined;
  let runtimeCiMatrix;
  try {
    runtimeCiMatrix = buildMatlabRuntimeCiMatrix({ productionRelease });
  } catch {
    runtimeCiMatrix = buildMatlabRuntimeCiMatrix();
  }
  return Object.freeze({
    ...result,
    runtimeCiMatrix,
  });
}
