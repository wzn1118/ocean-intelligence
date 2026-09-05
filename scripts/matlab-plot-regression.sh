#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"
output_directory="${repository_root}/codex-runtime/matlab/tests/output"
baseline_directory="${repository_root}/codex-runtime/matlab/tests/baseline"
evidence_directory=""
expected_release="${OCEAN_MATLAB_RELEASE:-R2026a}"
allow_unavailable=false

while (($#)); do
  case "$1" in
    --output-dir) output_directory="$2"; shift 2 ;;
    --baseline-dir) baseline_directory="$2"; shift 2 ;;
    --evidence-dir) evidence_directory="$2"; shift 2 ;;
    --expected-release) expected_release="$2"; shift 2 ;;
    --allow-unavailable) allow_unavailable=true; shift ;;
    --help)
      printf 'Usage: %s [--expected-release R2024b] [--output-dir DIR] [--baseline-dir DIR] [--evidence-dir DIR] [--allow-unavailable]\n' "$0"
      exit 0
      ;;
    *)
      if [[ "$1" != --* && "$output_directory" == "${repository_root}/codex-runtime/matlab/tests/output" ]]; then
        output_directory="$1"
        shift
      elif [[ "$1" != --* && "$baseline_directory" == "${repository_root}/codex-runtime/matlab/tests/baseline" ]]; then
        baseline_directory="$1"
        shift
      else
        printf 'ERROR: unknown argument: %s\n' "$1" >&2
        exit 2
      fi
      ;;
  esac
done

evidence_directory="${evidence_directory:-${output_directory}/ci-evidence}"
manifest_path="${output_directory}/figures.json"
probe_path="${evidence_directory}/matlab-runtime-probe.json"
log_path="${evidence_directory}/matlab-command.log"
regression_path="${evidence_directory}/matlab-regression-result.json"
evidence_path="${evidence_directory}/matlab-ci-evidence.json"
mkdir -p "$evidence_directory"

write_unavailable_evidence() {
  EXPECTED_RELEASE="$expected_release" EVIDENCE_PATH="$evidence_path" node --input-type=module <<'NODE'
import fs from 'node:fs';
import { classifyMatlabCiEvidence } from './codex-runtime/server/matlab-release-capabilities.mjs';
const evidence = classifyMatlabCiEvidence({
  jobId: `matlab-${process.env.EXPECTED_RELEASE.toLowerCase()}`,
  targetRelease: process.env.EXPECTED_RELEASE,
  runtimeContract: {
    status: 'unavailable',
    runtimeEvidence: { matlabAvailable: false, executionVerified: false, artifactsVerified: false },
    errors: [{ code: 'MATLAB_UNAVAILABLE', field: 'matlabAvailable', message: 'MathWorks MATLAB executable was not found.' }],
  },
  evidencePaths: { evidence: process.env.EVIDENCE_PATH },
});
fs.writeFileSync(process.env.EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`MATLAB_CI_STATUS=${evidence.status}`);
console.log(`MATLAB_CI_EVIDENCE=${process.env.EVIDENCE_PATH}`);
NODE
}

matlab_path="${OCEAN_MATLAB_EXECUTABLE:-}"
if [[ -z "$matlab_path" ]]; then matlab_path="$(command -v matlab 2>/dev/null || true)"; fi
if [[ -z "$matlab_path" || ! -x "$matlab_path" ]]; then
  write_unavailable_evidence
  printf 'MATLAB_RUNTIME=unavailable\nMATLAB_REGRESSION_SKIPPED=false\n'
  $allow_unavailable && exit 0
  exit 78
fi
matlab_path="$(realpath "$matlab_path")"
rm -rf "$output_directory"
mkdir -p "$output_directory" "$evidence_directory"

escape_matlab() { printf '%s' "$1" | sed "s/'/''/g"; }
probe_expression="probe=struct(); probe.runtime='matlab'; probe.vendor='MathWorks'; probe.release=version('-release'); probe.version=version; probe.executable='$(escape_matlab "$matlab_path")'; probe.jvm_available=usejava('jvm'); probe.desktop_available=usejava('desktop'); probe.display_available=~isempty(getenv('DISPLAY')); probe.headless=true; probe.non_interactive=true; probe.figure_visible=false; probe.matlab_license_tested=true; probe.matlab_license_available=license('test','MATLAB'); products=ver; probe.products=arrayfun(@(p) struct('name',p.Name,'version',p.Version),products); fid=fopen('$(escape_matlab "$probe_path")','w'); assert(fid~=-1); cleaner=onCleanup(@() fclose(fid)); fwrite(fid,jsonencode(probe),'char');"
"$matlab_path" -batch "$probe_expression" >"$log_path" 2>&1
probe_exit=$?
if ((probe_exit != 0)); then
  printf '{"status":"failed","reason":"MATLAB_PROBE_FAILED","exitCode":%d}\n' "$probe_exit" >"$regression_path"
else
  script_path="${repository_root}/codex-runtime/matlab/tests/run_plot_regression.m"
  command_expression="addpath('$(escape_matlab "$(dirname "$script_path")")'); run_plot_regression('$(escape_matlab "$output_directory")')"
  "$matlab_path" -batch "$command_expression" >>"$log_path" 2>&1
  matlab_exit=$?
  if ((matlab_exit == 0)); then
    node --input-type=module - "$manifest_path" "$output_directory" "$baseline_directory" >"$regression_path" <<'NODE'
import { inspectMatlabPlotRegression } from './codex-runtime/server/matlab-plot-regression.mjs';
const [manifestPath, outputDirectory, baselineDirectory] = process.argv.slice(2);
const result = inspectMatlabPlotRegression({
  manifestPath, outputDirectory, baselineDirectory,
  requireMatlab: true, requireSvg: true, requireRuntimeContract: true,
  requireScienceContract: true, requirePublicationContract: true,
  requireInteractionContract: true, expectHeadless: true,
});
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'passed') process.exitCode = 1;
NODE
    inspection_exit=$?
  else
    inspection_exit=1
    printf '{"status":"failed","reason":"MATLAB_PROCESS_EXIT_NONZERO","exitCode":%d}\n' "$matlab_exit" >"$regression_path"
  fi
fi

EXPECTED_RELEASE="$expected_release" MATLAB_PATH="$matlab_path" PROBE_PATH="$probe_path" LOG_PATH="$log_path" REGRESSION_PATH="$regression_path" EVIDENCE_PATH="$evidence_path" MANIFEST_PATH="$manifest_path" OUTPUT_DIRECTORY="$output_directory" PROBE_EXIT="${probe_exit:-1}" MATLAB_EXIT="${matlab_exit:-1}" INSPECTION_EXIT="${inspection_exit:-1}" node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { classifyMatlabCiEvidence } from './codex-runtime/server/matlab-release-capabilities.mjs';
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const probe = readJson(process.env.PROBE_PATH);
const regression = readJson(process.env.REGRESSION_PATH);
const exactReleaseMatch = probe.release === process.env.EXPECTED_RELEASE;
const executionPassed = Number(process.env.PROBE_EXIT) === 0 && Number(process.env.MATLAB_EXIT) === 0 && Number(process.env.INSPECTION_EXIT) === 0;
const artifacts = fs.existsSync(process.env.OUTPUT_DIRECTORY)
  ? fs.readdirSync(process.env.OUTPUT_DIRECTORY).filter((name) => /\.(?:png|pdf|svg)$/u.test(name)).sort()
  : [];
const runtimeContract = {
  status: executionPassed && regression.status === 'passed' && exactReleaseMatch ? 'verified' : 'failed',
  runtimeEvidence: {
    matlabAvailable: true, executable: process.env.MATLAB_PATH, executableIdentityVerified: probe.vendor === 'MathWorks',
    detectedRelease: probe.release || null, releaseEvidenceSource: "version('-release')", exactReleaseMatch,
    executionCompleted: Number(process.env.MATLAB_EXIT) === 0, executionVerified: executionPassed,
    exitCode: Number(process.env.MATLAB_EXIT), logCaptured: fs.existsSync(process.env.LOG_PATH),
    workingDirectory: process.cwd(), artifactsRequired: true,
    artifactsVerified: regression.status === 'passed' && artifacts.length > 0,
  },
  environment: { headless: probe.headless === true, displayAvailable: probe.display_available, desktopAvailable: probe.desktop_available, jvmAvailable: probe.jvm_available, nonInteractive: probe.non_interactive, figureVisible: probe.figure_visible },
  toolboxReadiness: { status: probe.matlab_license_available === true ? 'verified' : 'unavailable', products: probe.products || [], matlabLicenseTested: probe.matlab_license_tested === true, matlabLicenseAvailable: probe.matlab_license_available === true },
  manifest: { path: process.env.MANIFEST_PATH, verified: regression.manifestOk === true || regression.manifest?.ok === true },
  exports: { artifactFiles: artifacts },
  errors: [], missingInputs: [], warnings: [],
};
if (!exactReleaseMatch) runtimeContract.errors.push({ code: 'MATLAB_RELEASE_MISMATCH', field: 'detectedRelease', message: `Expected ${process.env.EXPECTED_RELEASE}, detected ${probe.release || 'unknown'}.` });
if (probe.matlab_license_available !== true) runtimeContract.errors.push({ code: 'MATLAB_LICENSE_UNAVAILABLE', field: 'license', message: 'Base MATLAB license test did not pass.' });
if (!executionPassed) runtimeContract.errors.push({ code: 'MATLAB_EXECUTION_FAILED', field: 'exitCode', message: 'MATLAB probe, render, or inspection failed.' });
const evidence = classifyMatlabCiEvidence({
  jobId: `matlab-${process.env.EXPECTED_RELEASE.toLowerCase()}`,
  targetRelease: process.env.EXPECTED_RELEASE,
  runtimeContract,
  command: `${process.env.MATLAB_PATH} -batch run_plot_regression(...)`,
  evidencePaths: { probe: process.env.PROBE_PATH, log: process.env.LOG_PATH, regression: process.env.REGRESSION_PATH, manifest: process.env.MANIFEST_PATH, artifactDirectory: process.env.OUTPUT_DIRECTORY },
});
fs.writeFileSync(process.env.EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`MATLAB_CI_STATUS=${evidence.status}`);
console.log(`MATLAB_CI_EVIDENCE=${process.env.EVIDENCE_PATH}`);
process.exitCode = evidence.exitCode;
NODE
exit $?
