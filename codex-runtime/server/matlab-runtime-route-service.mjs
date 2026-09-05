import { resolveMatlabPlotRequest } from './matlab-plot-router.mjs';
import {
  buildMatlabRuntimeCiMatrix,
  normalizeMatlabRelease,
  selectMatlabRuntimeValidationLane,
} from './matlab-release-capabilities.mjs';
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
  } catch (error) {
    const reason = String(error?.message || error);
    return Object.freeze({
      ...result,
      status: 'needs-input',
      ready: false,
      script: null,
      runtimeCiMatrix: null,
      runtimeReport: buildRuntimeReport(result, input, null, {
        code: 'MATLAB_CI_RELEASE_INVALID',
        reason,
        nextAction: 'Use a known productionRelease and rerun MATLAB route selection.',
      }),
      error: {
        code: 'MATLAB_CI_RELEASE_INVALID',
        reason,
        nextAction: 'Use a known productionRelease and rerun MATLAB route selection.',
      },
    });
  }
  return Object.freeze({
    ...result,
    runtimeCiMatrix,
    runtimeReport: buildRuntimeReport(result, input, runtimeCiMatrix),
  });
}

function buildRuntimeReport(result, input, runtimeCiMatrix, configurationError = null) {
  const requestedRelease = isMatlabJsonObject(input)
    ? input.targetRelease || input.matlabRelease || result.plotRoute?.targetRelease || 'R2026a'
    : 'R2026a';
  let targetRelease = null;
  let validationLane = null;
  const failures = [];
  if (configurationError) failures.push(configurationError);
  try {
    targetRelease = normalizeMatlabRelease(requestedRelease);
    if (runtimeCiMatrix) {
      const productionRelease = runtimeCiMatrix.jobs.find((job) => job.purpose === 'production')?.targetRelease;
      validationLane = selectMatlabRuntimeValidationLane(targetRelease, { productionRelease });
      if (validationLane.status !== 'exact') {
        failures.push({
          code: 'MATLAB_EXACT_RUNTIME_EVIDENCE_PENDING',
          reason: validationLane.limitation,
          nextAction: `Run an exact MathWorks MATLAB ${targetRelease} validation lane.`,
        });
      }
    }
  } catch (error) {
    failures.push({
      code: 'MATLAB_TARGET_RELEASE_INVALID',
      reason: String(error?.message || error),
      nextAction: 'Use a supported MATLAB release in RYYYYa/RYYYYb form.',
    });
  }
  if (result.error) failures.push(result.error);
  const unresolvedRequirements = new Set([
    ...(result.plotRoute?.unresolvedRequirements || []),
    ...(result.scientificDataContract?.unresolvedRequirements || []),
    ...(result.publicationContract?.unresolvedRequirements || []),
    ...(result.taskRoute?.scientificDataContract?.unresolvedRequirements || []),
    ...(result.taskRoute?.publicationContract?.unresolvedRequirements || []),
  ]);
  for (const requirement of unresolvedRequirements) {
    failures.push({
      code: 'MATLAB_PLOT_REQUIREMENT_UNRESOLVED',
      reason: requirement,
      nextAction: 'Supply the missing scientific or publication metadata before generation.',
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    status: result.ready === true && failures.length === 0 ? 'ready-for-runtime-validation' : 'blocked',
    authoritativeRuntime: 'mathworks-matlab',
    octaveAcceptedAsMatlabEvidence: false,
    targetRelease,
    validationLane,
    evidenceRequired: [
      'exact MathWorks MATLAB release identity',
      'nonzero command exit status propagation',
      'toolbox installation, license, resolution and invocation evidence',
      'fresh PNG/PDF artifacts and verified figures.json hashes',
    ],
    failures: Object.freeze(failures),
  });
}
