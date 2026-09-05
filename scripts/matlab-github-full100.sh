#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected_release="${1:?usage: matlab-github-full100.sh <R20XXa|R20XXb> [output-directory]}"
output_root="${2:-${RUNNER_TEMP:-/tmp}/ocean-matlab-full100-${expected_release}}"
matlab_executable="${OCEAN_MATLAB_EXECUTABLE:-$(command -v matlab || true)}"

if [[ -z "$matlab_executable" ]]; then
  printf 'MATLAB_RUNTIME=unavailable\nRequired command not found: matlab\n' >&2
  exit 78
fi

rm -rf "$output_root"
mkdir -p \
  "$output_root/regression/run" \
  "$output_root/regression/evidence" \
  "$output_root/family-b" \
  "$output_root/export" \
  "$output_root/interaction-headless"

export OCEAN_MATLAB_EXECUTABLE="$matlab_executable"
export OCEAN_MATLAB_RELEASE="$expected_release"

"$repository_root/scripts/matlab-plot-regression.sh" \
  --expected-release "$expected_release" \
  --output-dir "$output_root/regression/run" \
  --evidence-dir "$output_root/regression/evidence"

matlab_quote() {
  printf "%s" "$1" | sed "s/'/''/g"
}

quoted_repository="$(matlab_quote "$repository_root")"
quoted_tests="$(matlab_quote "$repository_root/codex-runtime/matlab/tests")"
quoted_assets="$(matlab_quote "$repository_root/codex-runtime/matlab/assets")"
quoted_family_b="$(matlab_quote "$output_root/family-b")"
quoted_export="$(matlab_quote "$output_root/export")"
quoted_interaction="$(matlab_quote "$repository_root/.codex-evals/matlab-100-20260905/interaction")"
quoted_interaction_output="$(matlab_quote "$output_root/interaction-headless")"

"$matlab_executable" -batch "cd('$quoted_repository'); addpath('$quoted_assets','$quoted_tests'); full100_family_a_contracts; full100_family_b_runtime('$quoted_family_b'); full100_family_c_contracts; cd('$quoted_export'); run(fullfile('$quoted_tests','full100_export_runtime_gate.m'));"

"$matlab_executable" -batch "cd('$quoted_repository'); addpath('$quoted_interaction'); run_interaction_acceptance('headless','$quoted_interaction_output');"

node "$repository_root/.codex-evals/matlab-100-20260905/interaction/validate_interaction_evidence.mjs" \
  "$output_root/interaction-headless/headless-interaction-evidence.json"

python3 "$repository_root/codex-runtime/matlab/evals/evaluate.py" \
  --runtime require \
  --output-dir "$output_root/evaluator-runtime" \
  --result "$output_root/evaluator-result.json" \
  --timeout 1800

python3 - "$output_root" "$expected_release" "$matlab_executable" <<'PY'
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1]).resolve()
release = sys.argv[2]
executable = sys.argv[3]
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
    "matlab_executable": executable,
    "files": files,
}
(root / "artifact-inventory.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

printf 'MATLAB_FULL100_STATUS=runtime_passed_visual_pending\n'
printf 'MATLAB_FULL100_RELEASE=%s\n' "$expected_release"
printf 'MATLAB_FULL100_OUTPUT=%s\n' "$output_root"
