#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected_release="${1:?usage: matlab-github-full100.sh <R20XXa|R20XXb> <output-directory> <nonce> <start-marker>}"
output_root="${2:-${RUNNER_TEMP:-/tmp}/ocean-matlab-full100-${expected_release}}"
runtime_nonce="${3:?usage: matlab-github-full100.sh <release> <output-directory> <nonce> <start-marker>}"
start_marker="${4:?usage: matlab-github-full100.sh <release> <output-directory> <nonce> <start-marker>}"
summary_path="$output_root/ci-validation-summary.json"
inventory_path="$output_root/artifact-inventory.json"
failures=()
checks=()

mkdir -p "$output_root"

record_check() {
  local identifier="$1"
  local status="$2"
  local detail="$3"
  checks+=("$identifier|$status|$detail")
  if [[ "$status" != passed ]]; then
    failures+=("$identifier: $detail")
  fi
}

require_file() {
  local identifier="$1"
  local path="$2"
  if [[ -f "$path" && ! -L "$path" && -s "$path" ]]; then
    record_check "$identifier" passed "$path"
    return 0
  fi
  record_check "$identifier" failed "missing nonempty regular file: $path"
  return 1
}

run_check() {
  local identifier="$1"
  shift
  local log_path="$output_root/${identifier}.log"
  if "$@" >"$log_path" 2>&1; then
    record_check "$identifier" passed "$log_path"
    return 0
  else
    local status=$?
    record_check "$identifier" failed "exit $status; log: $log_path"
    return 0
  fi
}

if [[ "$expected_release" =~ ^R20[0-9]{2}[ab]$ ]]; then
  record_check release-format passed "$expected_release"
else
  record_check release-format failed "invalid MATLAB release: $expected_release"
fi

if [[ ${#runtime_nonce} -ge 32 ]]; then
  record_check nonce-length passed "${#runtime_nonce} characters"
else
  record_check nonce-length failed "nonce is shorter than 32 characters"
fi

if require_file start-marker "$start_marker"; then
  run_check start-marker-binding python3 - "$start_marker" "$expected_release" "$runtime_nonce" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

marker = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert marker.get("schema_version") == 1, "start marker schema mismatch"
assert marker.get("expected_release") == sys.argv[2], "start marker release mismatch"
actual = hashlib.sha256(sys.argv[3].encode("utf-8")).hexdigest()
assert marker.get("nonce_sha256") == actual, "start marker nonce hash mismatch"
PY
fi

require_file runtime-probe "$output_root/matlab-runtime-probe.json" || true
require_file stage-status "$output_root/ci-stage-status.json" || true

if require_file evaluator-runtime-record "$output_root/evaluator-runtime/matlab-runtime.json"; then
  run_check runtime-release-binding python3 - \
    "$output_root/evaluator-runtime/matlab-runtime.json" "$expected_release" <<'PY'
import json
import sys
from pathlib import Path

record = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert record.get("runtime") == "MathWorks MATLAB", "runtime vendor mismatch"
assert record.get("matlab_release") == sys.argv[2], "MATLAB release mismatch"
assert record.get("success") is True, "runtime record does not prove success"
PY
fi

if require_file regression-manifest "$output_root/regression/run/figures.json"; then
  run_check regression-contract node --input-type=module - "$output_root/regression/run/figures.json" "$output_root/regression/run" <<'NODE'
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
fi

if require_file interaction-evidence "$output_root/interaction-headless/headless-interaction-evidence.json"; then
  run_check interaction-contract node \
    "$repository_root/.codex-evals/matlab-100-20260905/interaction/validate_interaction_evidence.mjs" \
    "$output_root/interaction-headless/headless-interaction-evidence.json"
fi

run_check evaluator-runtime python3 "$repository_root/codex-runtime/matlab/evals/evaluate.py" \
  --runtime require \
  --output-dir "$output_root/evaluator-unused" \
  --runtime-evidence-dir "$output_root/evaluator-runtime" \
  --runtime-nonce "$runtime_nonce" \
  --runtime-start-marker "$start_marker" \
  --result "$output_root/evaluator-result.json" \
  --timeout 1800

if [[ ! -s "$output_root/evaluator-result.json" ]]; then
  python3 - "$output_root/evaluator-result.json" "$output_root/evaluator-runtime.log" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

log_path = Path(sys.argv[2])
payload = {
    "schema_version": 1,
    "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "status": "failed",
    "score": 0,
    "maximum_score": 100,
    "error": log_path.read_text(encoding="utf-8", errors="replace")[-12000:],
}
Path(sys.argv[1]).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY
fi

CHECK_RECORDS="$(printf '%s\n' "${checks[@]-}")" FAILURE_RECORDS="$(printf '%s\n' "${failures[@]-}")" \
python3 - "$summary_path" "$expected_release" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def records(name):
    values = []
    for line in os.environ.get(name, "").splitlines():
        if not line:
            continue
        parts = line.split("|", 2)
        if len(parts) == 3:
            values.append({"id": parts[0], "status": parts[1], "detail": parts[2]})
        else:
            values.append({"detail": line})
    return values

checks = records("CHECK_RECORDS")
failures = [line for line in os.environ.get("FAILURE_RECORDS", "").splitlines() if line]
payload = {
    "schema_version": 1,
    "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "expected_release": sys.argv[2],
    "status": "passed" if not failures else "failed",
    "checks": checks,
    "failures": failures,
}
Path(sys.argv[1]).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

python3 - "$output_root" "$expected_release" "$inventory_path" <<'PY'
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1]).resolve()
release = sys.argv[2]
inventory_path = Path(sys.argv[3]).resolve()
files = []
for path in sorted(root.rglob("*")):
    if not path.is_file() or path.resolve() == inventory_path:
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
    "matlab_action": "matlab-actions/run-command@v3",
    "files": files,
}
inventory_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
  {
    printf '### MATLAB %s full-score validation\n\n' "$expected_release"
    if ((${#failures[@]} == 0)); then
      printf -- '- Status: `runtime_passed_visual_pending`\n'
    else
      printf -- '- Status: `failed`\n'
      for failure in "${failures[@]}"; do
        printf -- '- %s\n' "$failure"
      done
    fi
    printf -- '- Evidence: `%s`\n' "$output_root"
  } >> "$GITHUB_STEP_SUMMARY"
fi

if ((${#failures[@]} > 0)); then
  printf 'MATLAB_FULL100_STATUS=failed\n'
  printf 'MATLAB_FULL100_FAILURE_COUNT=%s\n' "${#failures[@]}"
  printf '%s\n' "${failures[@]}" >&2
  exit 1
fi

printf 'MATLAB_FULL100_STATUS=runtime_passed_visual_pending\n'
printf 'MATLAB_FULL100_RELEASE=%s\n' "$expected_release"
printf 'MATLAB_FULL100_OUTPUT=%s\n' "$output_root"
