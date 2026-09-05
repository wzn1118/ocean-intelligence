#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected_release="${1:?usage: matlab-github-full100.sh <R20XXa|R20XXb> [output-directory]}"
output_root="${2:-${RUNNER_TEMP:-/tmp}/ocean-matlab-full100-${expected_release}}"
runtime_nonce="${3:?usage: matlab-github-full100.sh <release> <output-directory> <nonce> <start-marker>}"
start_marker="${4:?usage: matlab-github-full100.sh <release> <output-directory> <nonce> <start-marker>}"

test -f "$start_marker"
test -f "$output_root/matlab-runtime-probe.json"
test -f "$output_root/regression/run/figures.json"

node --input-type=module - "$output_root/regression/run/figures.json" "$output_root/regression/run" > "$output_root/regression-result.json" <<'NODE'
import { inspectMatlabPlotRegression } from './codex-runtime/server/matlab-plot-regression.mjs';
const [manifestPath, outputDirectory] = process.argv.slice(2);
const result = inspectMatlabPlotRegression({
  manifestPath, outputDirectory, baselineDirectory: '',
  requireMatlab: true, requireSvg: true, requireRuntimeContract: true,
  requireScienceContract: true, requirePublicationContract: true,
  requireInteractionContract: true, expectHeadless: true,
});
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'passed') process.exitCode = 1;
NODE

node "$repository_root/.codex-evals/matlab-100-20260905/interaction/validate_interaction_evidence.mjs" \
  "$output_root/interaction-headless/headless-interaction-evidence.json"

python3 "$repository_root/codex-runtime/matlab/evals/evaluate.py" \
  --runtime require \
  --output-dir "$output_root/evaluator-unused" \
  --runtime-evidence-dir "$output_root/evaluator-runtime" \
  --runtime-nonce "$runtime_nonce" \
  --runtime-start-marker "$start_marker" \
  --result "$output_root/evaluator-result.json" \
  --timeout 1800

python3 - "$output_root" "$expected_release" <<'PY'
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1]).resolve()
release = sys.argv[2]
files = []
for path in sorted(root.rglob("*")):
    if not path.is_file() or path.name == "artifact-inventory.json":
        continue
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    files.append({
        "path": path.relative_to(root).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": digest,
    })
payload = {
    "schema_version": 1,
    "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "runtime": "MathWorks MATLAB",
    "expected_release": release,
    "matlab_executable": "matlab-actions/run-command@v3",
    "files": files,
}
(root / "artifact-inventory.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

printf 'MATLAB_FULL100_STATUS=runtime_passed_visual_pending\n'
printf 'MATLAB_FULL100_RELEASE=%s\n' "$expected_release"
printf 'MATLAB_FULL100_OUTPUT=%s\n' "$output_root"
