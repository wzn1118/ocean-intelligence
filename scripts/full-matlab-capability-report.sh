#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_directory="${1:-/tmp/ocean-matlab-full-capability-report}"
expected_release="${2:-${OCEAN_MATLAB_RELEASE:-R2026a}}"
run_directory="${output_directory}/run"
evidence_directory="${output_directory}/evidence"
archive_path="${output_directory}/matlab-capability-${expected_release}.tar.gz"
checksum_path="${archive_path}.sha256"

rm -rf "$output_directory"
mkdir -p "$run_directory" "$evidence_directory"
"${repository_root}/scripts/matlab-plot-regression.sh" \
  --expected-release "$expected_release" \
  --output-dir "$run_directory" \
  --evidence-dir "$evidence_directory"
run_exit=$?

cat >"${output_directory}/README.txt" <<REPORT
Authoritative runtime: MathWorks MATLAB
Expected release: ${expected_release}
Runtime result: evidence/matlab-ci-evidence.json
Command log: evidence/matlab-command.log
Runtime probe: evidence/matlab-runtime-probe.json
Regression result: evidence/matlab-regression-result.json
Expected render outputs: run/*.png, run/*.pdf, run/*.svg, run/figures.json
Octave policy: GNU Octave results are not accepted and cannot change MATLAB status.
Exit code policy: 0=passed, 1=failed, 77=skipped, 78=unavailable.
REPORT

tar -czf "$archive_path" -C "$output_directory" README.txt evidence run
sha256sum "$archive_path" >"$checksum_path"
printf 'MATLAB_CAPABILITY_ARCHIVE=%s\nMATLAB_CAPABILITY_SHA256=%s\n' "$archive_path" "$checksum_path"
exit "$run_exit"
