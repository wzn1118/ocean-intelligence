# Round 19 Canvas Probe Contract Review

Scope: read-only review of the uncommitted canvas experiment, its callers,
workflow archiving and existing offline summarizer. This document is the only
workspace file added by this review. No MATLAB execution, uploaded-artifact
verification, page-size verification, font/visual approval or new score is
claimed.

Baseline HEAD: `e9ca42d6346ca46420d526023f10da1fc5ac2fc8`.
Reviewed probe SHA256:
`88db481d0dda980baffd9c0b6a2da0c831ce19bde65f8987a9e7eab698f66bed`.
Reviewed summarizer SHA256:
`83ac86f7d5f712b70811459de3eed4df64dcff188562b2c45e700be5066f6064`.

## Findings

### P2: Canvas failures are invisible in the aggregate summaries

The main summarizer reads stage status, probe, evaluator and postprocessing
files, but not `native-pdf-page-probe.json` or either canvas child report:
[summarize_ci.py](/opt/ocean-intelligence/codex-runtime/matlab/evals/summarize_ci.py:445).
Its DISPLAY reader only reads `display-comparison/display-rendering.json`:
[summarize_ci.py](/opt/ocean-intelligence/codex-runtime/matlab/evals/summarize_ci.py:343).
The DISPLAY wrapper marks the native-page callback `export_checks_completed`
whenever that function returns without throwing:
[test_display_rendering.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_display_rendering.m:38).

The probe deliberately catches whole-experiment exceptions and does not assert
on canvas candidate failures:
[test_native_pdf_page_probe.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:98).
Consequently, successful original candidates plus a failed canvas PDF, PNG or
geometry capture still produce an old native-page stage `passed` and a DISPLAY
callback `export_checks_completed`. The canvas error is saved in raw JSON/logs,
but no canvas failure, incomplete status or scope warning reaches the aggregate
JSON/Markdown. Missing or partial canvas files are also not inspected there.

This is an observability gap, not evidence that the new candidates receive
stage points. `stage_status_scope=original_three_candidates_export_checks_only`
exists in the probe report but is not imported into either summary. Readers
must not interpret the existing stage/table cell as canvas success.

Reproduction: seven reduced synthetic Python-only failure/partial-record cases
were placed under both primary and DISPLAY probe directories in a temporary
test bundle. Aggregate JSON remained identical to the baseline in all cases;
neither a distinctive canvas error identifier nor the canvas directory name
appeared in Markdown. No evaluator score was supplied by these unit inputs.

Suggested coordinator action: expose canvas status/errors or an explicit
not-summarized warning in a separate diagnostics-only surface. Keep it outside
the main stage denominator, score and visual flags. No summarizer was edited.

### P2: Optional report rewrite is not isolated from the original stage

After the original three-candidate report has been completed and saved, the
new experiment runs inside a try/catch. The following parent-report rewrite is
outside that catch:
[test_native_pdf_page_probe.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:110).
`write_report` opens the same file with `wb`, then asserts complete writing:
[test_native_pdf_page_probe.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:545).
An open/serialization/short-write failure at this new optional rewrite escapes
before the original assertion. A short write can additionally truncate the
previously complete three-candidate JSON. The caller then records the original
native-page stage as failed:
[run_github_full100.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/run_github_full100.m:160).

For example, exhausting writable space while creating diagnostic exports can
leave all three original exports successful but make the optional final
rewrite fail. `counts_toward_stage=false` does not isolate this I/O path.
Ordinary caught PDF/PNG/geometry failures do not have this propagation problem.

This is a conditional static exception-path finding, NOT an observed MATLAB
or CI failure; no MATLAB I/O fault injection was performed. Preserve the
already-complete old report on optional rewrite failure and record the
diagnostic failure separately, without weakening the old export assertion.

## Confirmed Boundaries

- The original candidate IDs remain `axes-outerposition`, `tiledlayout-loose`
  and `panel-fullpage`. `report.summary.candidate_count` remains 3; success,
  failure and skip counts use only these candidates. The original
  `assert(all(statuses == "exported"))` still uses their local status vector:
  [test_native_pdf_page_probe.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:51),
  [summary](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:88),
  [assertion](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:115).
- The independent experiment has two candidates, inset 0 and 3 points, and
  its own `candidate_count=2`. Its counters are not added to the old summary:
  [experiment summary](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:200).
- No extra main stage or DISPLAY callback is registered. DISPLAY still has
  exactly three callbacks, not five:
  [main registration](/opt/ocean-intelligence/codex-runtime/matlab/tests/run_github_full100.m:84),
  [DISPLAY registration](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_display_rendering.m:24).
- New exact-page, font, CJK, text-extraction and layout verification flags
  remain false; external inspection remains pending. Header/literal geometry
  reads and `captured` snapshots are not measurements of visual correctness:
  [experiment scope](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:154).

## Failure and Partial-File Paths

| Condition | Source-level outcome and retained evidence |
| --- | --- |
| Setup throws | setup_status=failed and identifier/message retained; exports not_attempted_setup_failed; candidate failed. Geometry attempts retain capture_failed rather than inventing geometry. |
| PDF export throws, including leaving a partial file | export_call_succeeded remains false; any existing bytes/hash are recorded; PDF status stays failed. PNG is attempted separately. |
| PNG export throws after a successful PDF | PDF evidence remains available; PNG failed; pair failed rather than completed. |
| Missing/empty file, missing PDF header, failed hash/header read | Artifact failed; inspection status/error and file existence/bytes remain available where readable. |
| Either export succeeds but any of the three geometry snapshots fails | Both artifact statuses may be exported, but candidate failed; nested capture_failed and identifier/message explain the discrepancy. |
| No literal MediaBox found but PDF call/header/hash checks succeed | PDF may be exported with no_literal_mediabox_external_check_required. This is explicitly not exact-page verification. |
| Font or exportgraphics unavailable | Both experiment artifacts skipped, candidate skipped, experiment incomplete; old three-candidate assertion remains unchanged. |
| Exception escapes experiment orchestration | Parent gets a failed diagnostic entry and stderr error marker. Already written child/partial files are not deleted. |
| Interruption or child JSON write failure between PDF and PNG | Last durable candidate/experiment record can remain pending/running/not_attempted while files exist. Such records are not completed pairs and must not be inferred complete from old parent status or file count. |

Relevant implementation locations:
[setup and export sequence](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:252),
[candidate completion predicate](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:272),
[artifact exception and inspection handling](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:284),
[geometry exception handling](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:377).
Unavailable optional graphics properties are listed in `unavailable_properties`;
`captured` does not assert that every requested property exists on every release.

The primary parent report records completion of the OLD candidates before
starting the experiment. Its completed_at/status are therefore not an experiment
completion marker. Read the experiment's own status, both candidate records,
each artifact status and all three geometry statuses together.

## Archiving

The configured upload is `if: always()` and includes the entire release output
directory, with no candidate-file allowlist or exclusion:
[matlab-full100.yml](/opt/ocean-intelligence/.github/workflows/matlab-full100.yml:190).
The new, nonhidden files are consequently inside its configured scope at both:

```text
<release-root>/native-pdf-page-probe/canvas-extent-experiment/
<release-root>/display-comparison/native-pdf-page-probe/canvas-extent-experiment/
```

Each contains `canvas-extent-experiment.json` plus candidate subdirectories
`panel-canvas-inset-0pt/` and `panel-canvas-inset-3pt/`, with `candidate.json`,
`native.pdf` and `native-reference.png` when those files were created. Failure
does not trigger cleanup of these partial files. The parent probe report is
also under the same upload root. This checks configuration coverage only,
not a completed GitHub upload/download or actual file completeness.

The root `artifact-inventory.json` recursively hashes files that exist when
postprocessing runs:
[matlab-github-full100.sh](/opt/ocean-intelligence/scripts/matlab-github-full100.sh:191).
It covers primary experiment files present then. DISPLAY runs later, after
that inventory is generated, so its new files are not in that root inventory:
[postprocessing](/opt/ocean-intelligence/.github/workflows/matlab-full100.yml:139),
[DISPLAY execution](/opt/ocean-intelligence/.github/workflows/matlab-full100.yml:162).
They remain inside the final upload root and have their local artifact hashes.
Do not equate root-inventory absence with upload exclusion, or root-inventory
presence with complete/valid PDF/PNG evidence. This ordering predates this change.

## Validation and Limits

Executed from `/tmp`, without changing source tests:

```text
python3 -B -m unittest discover -s /opt/ocean-intelligence/codex-runtime/matlab/evals/tests -p test_ci_summary.py
```

Result: 43 tests passed. The seven temporary synthetic summary-boundary cases
also passed their assertions that canvas failure records are currently omitted
from aggregate output. These Python checks do not execute the MATLAB producer,
exercise native export/geometry APIs, or prove the optional-write failure path
on MATLAB. No current canvas runtime artifacts were supplied for this review.

Only this review document was added. No producer, workflow, summarizer, score,
freeze, existing report or runtime package was edited; no commit or push made.
