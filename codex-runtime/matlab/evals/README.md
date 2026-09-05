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

The runtime output directory must not exist before a real run. Remove only that
generated directory between CI attempts; never reuse artifacts. Full CI inputs,
expected outputs, and failure conditions are machine-readable in
`ci-inputs.json`. Without MathWorks MATLAB, the only honest status is
`runtime_pending`; Octave output cannot satisfy either runtime gate.
