import path from 'node:path';
import { inspectIllustratedReportEvidence, inspectReportMatlabSources } from './illustrated-report-contract.mjs';
import { inspectMatlabPlotQuality } from './matlab-plot-quality.mjs';

export function inspectReportStatusEvidence({ report, policy, generatedRoot } = {}) {
  const violations = [];
  const reportId = report?.id;
  const validId = typeof reportId === 'string' && /^[a-z0-9][a-z0-9-]{7,79}$/u.test(reportId);
  const boundPolicy = policy && typeof policy === 'object' && !Array.isArray(policy)
    && validId && policy.reportId === reportId;
  if (!validId) violations.push('report-id-invalid');
  if (!boundPolicy) violations.push('report-policy-missing');
  if (policy && policy.profile !== 'matlab-illustrated-v1') violations.push('report-policy-unsupported');
  if (!boundPolicy || policy.profile !== 'matlab-illustrated-v1') {
    return {
      ok: false,
      violations,
      matlabPlotQuality: { matlabPlotQualityOk: false, skipped: true, reason: 'report-policy-not-verified' },
      illustratedReportEvidence: { ok: false, pathsOk: false, skipped: true, reason: 'report-policy-not-verified', artifactChecks: [] },
      pointInteractionQualities: [],
    };
  }
  const root = typeof generatedRoot === 'string' && generatedRoot.trim() ? path.resolve(generatedRoot) : undefined;
  const file = (suffix) => validId && root ? path.join(root, `${reportId}${suffix}`) : undefined;
  const manifestPath = file('-figures.json');
  let illustratedReportEvidence;
  try {
    illustratedReportEvidence = inspectIllustratedReportEvidence({
      outputDirectory: root,
      htmlPath: file('.html'),
      markdownPath: file('.md'),
      manifestPath,
      expectedReportId: validId ? reportId : '',
    });
  } catch {
    illustratedReportEvidence = { ok: false, pathsOk: false, violations: ['inspection-error'], artifactChecks: [] };
  }
  if (illustratedReportEvidence.pathsOk !== true) violations.push('report-entry-path-invalid');
  if (illustratedReportEvidence.manifestOk !== true) violations.push('report-manifest-invalid-or-missing');
  if (illustratedReportEvidence.artifactPathsOk === false) violations.push('report-export-path-invalid');
  if (!illustratedReportEvidence.ok) violations.push('report-illustrated-evidence-failed');

  const pointInteractionQualities = (illustratedReportEvidence.artifactChecks || [])
    .filter((artifact) => artifact.format === 'html' && artifact.interactionQuality)
    .map((artifact) => artifact.interactionQuality);
  if (pointInteractionQualities.length === 0) violations.push('report-point-interaction-missing');
  if (pointInteractionQualities.some((quality) => !quality.pointInteractionQualityOk)) {
    violations.push('report-point-interaction-failed');
  }

  const sources = inspectReportMatlabSources({ outputDirectory: root, expectedReportId: reportId });
  if (!sources.ok) violations.push(sources.sourcePaths.length === 0 ? 'report-matlab-sources-missing' : 'report-matlab-sources-invalid');
  let matlabPlotQuality = {
    matlabPlotQualityOk: false,
    skipped: true,
    reason: 'report-evidence-preflight-failed',
    sourcePaths: sources.sourcePaths,
    sourceViolations: sources.violations,
  };
  if (illustratedReportEvidence.pathsOk === true && illustratedReportEvidence.manifestOk === true
      && illustratedReportEvidence.artifactPathsOk === true && sources.ok) {
    try {
      matlabPlotQuality = inspectMatlabPlotQuality({
        sourcePaths: sources.sourcePaths,
        manifestPath,
        outputDirectory: root,
      });
    } catch {
      matlabPlotQuality = { ...matlabPlotQuality, reason: 'inspection-error' };
    }
  }
  if (!matlabPlotQuality.matlabPlotQualityOk) violations.push('report-matlab-plot-quality-failed');
  return { ok: violations.length === 0, violations, matlabPlotQuality, illustratedReportEvidence, pointInteractionQualities };
}
