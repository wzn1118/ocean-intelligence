# MATLAB 100-point evaluation framework

This directory is the executable half of the MATLAB full-score gate. It uses
three deterministic synthetic fixtures, all explicitly marked as non-observed
data. Every fixture repeats multiple depths at multiple UTC times; time and
depth therefore form a crossed design instead of a one-to-one confounded axis.

## Layers

1. `evaluate.py --runtime skip` validates fixtures, scientific contracts,
   anti-cheat behavior, static MATLAB source, tests, and the frozen hash set.
2. `evaluate.py --runtime require` launches the real `matlab -batch` process,
   creates a fresh output directory, binds it to an evaluator nonce, executes
   plotting and interaction assertions, and rehashes PNG/PDF/SVG externally.
3. A trusted `visual-audit.json` must bind to the manifest and every artifact
   hash before glyphs, vector fonts, clipping, accessibility, DataTip, Brush,
   and headless behavior can receive the final 10 points.

Candidate-provided `score`, `status`, comments, strings, reports, Octave logs,
or nested gate fields are never scoring inputs. Only evaluator-owned results
contribute to the score defined in `rubric.json`.

## Native Generator Smoke

The GitHub workflow prepares two scripts through the actual server plot router,
then runs them in the licensed MATLAB process as `generated-router-runtime`.
The cases cover a static time series and a headless interactive time series
with declared synthetic inputs, missing values, units, UTC times, and stable
observation IDs. Generated source and inputs are hash-bound in a fresh
`generated-router` directory. Preparation or execution failure remains a failed
stage; it does not prevent collecting the other stages.

This is an additional regression check, not all-route coverage, a score bonus,
or evidence of desktop interaction or visual correctness. The independent
publication, evaluator, external artifact, and trusted visual gates still apply.

Reports bind statistics to the fixture snapshots actually consumed by MATLAB,
not just to same-named files. Snapshot bytes and SHA-256 must match runtime
records and report inputs. Synthetic benchmark results must not be described
as observed conditions in a real ocean region.

Reports also distinguish file hashes/dimensions from the declared coverage of
graphics bounds. Native layout text without public geometry remains unmeasured;
old manifests without coverage fields are reported as unavailable, not complete.

For the temperature field and salinity profiles, the MATLAB gate passes the
fixture's complete QC and uncertainty arrays to the plotting helpers without
filtering or drawing uncertainty bands. It reads native image/line values and
the helpers' returned arrays into `scientific_data_contract.plot_data_evidence`.
The report checks every value, order, mask, unit, policy, release and fixture hash.
Matching runtime input snapshots are required for `runtime_declaration_verified`;
missing declarations remain `not_verified`, and inconsistent declarations fail.
This is not a visual audit or independent re-execution. Other figures do not
inherit this evidence merely because their source metadata contains QC.

The GitHub postprocessing probe uses the same MathWorks `run-matlab-command`
launcher as `matlab-actions/run-command@v3`, with online batch licensing enabled.
It still runs the MATLAB vendor assertion and parses the actual release marker;
it does not reuse an old probe or bypass the runtime and visual gates. Local
inspection defaults to the ordinary `matlab` launcher. The action's packaged
launcher path is explicit in the workflow and must be checked on action upgrades.
Observed direct-launch failures in run 33987455982 are retained in its sanitized
`regression-contract.log`; no license credentials are copied or installed.

Native page and vector-text probes preserve experimental files separately from
promoted publication artifacts. An export call completing is not a finding that
the experimental PDF has exact dimensions, embedded fonts, or correct layout.

The workflow also runs publication and native PDF probes on an isolated Xvfb
display after the primary gates. The `display-comparison` directory
and display-server logs are independent diagnostics. `summarize_ci.py` displays
them separately, without adding stages or points or changing the main outcome.
Virtual display availability and callback completion do not prove desktop
interaction, font embedding, text alignment, or a successful visual review.

Run 33989124823 retained a no-display baseline on all three releases. Its R2026a
display controls removed the observed text-anchor clipping in two samples while
preserving exact pages; R2021a/R2024b print fonts remained unembedded. The next
full R2026a gate uses the same Xvfb environment as a candidate rendering setup,
with actual display and screen DPI recorded. This changes the R2026a environment,
not the artifacts or acceptance rules; it is not an all-figure visual approval.
The two older primary jobs remain no-display. Desktop interaction stays unverified.

## Commands

```bash
python3 -m unittest discover -s codex-runtime/matlab/evals/tests -p 'test_*.py' -v
python3 codex-runtime/matlab/evals/evaluate.py --runtime skip
python3 codex-runtime/matlab/evals/evaluate.py --runtime require \
  --output-dir .codex-evals/matlab-100-20260905/framework/runtime-output \
  --visual-audit /trusted-input/visual-audit.json \
  --result .codex-evals/matlab-100-20260905/framework/runtime-evaluation.json
python3 codex-runtime/matlab/evals/evaluate.py --write-freeze
python3 codex-runtime/matlab/evals/evaluate.py --verify-freeze
```

`--write-freeze` and `--verify-freeze` are inventory-only modes. Do not combine
them with `--runtime skip` to claim that the full static evaluation was run.

The runtime output directory must not exist before a real run. Remove only that
generated directory between CI attempts; never reuse artifacts. Full CI inputs,
expected outputs, and failure conditions are machine-readable in
`ci-inputs.json`. Without MathWorks MATLAB, the only honest status is
`runtime_pending`; Octave output cannot satisfy either runtime gate.
