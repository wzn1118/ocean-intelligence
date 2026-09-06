# Round 21: Native Comparison Mutation Review

Reviewed 2026-09-06 UTC. Scope: real native adversarial-suite evidence only.
Run: `34000171748`; commit: `31e74db52922031dfe1f15b7f385c38e620a9d7f`.
Packages: `/tmp/matlab-run-34000171748/matlab-full100-{R2021a,R2024b,R2026a}`.
Evidence directory in each package: `family-b/comparison-native-evidence-adversarial-test/`.
R2026a was added after its complete package and job `101397614010` log became available.

## Findings

- All three reviewed releases completed all 36 expected native reader rejections and four positive cases each. This conclusion uses actual job-log records, parsed completion JSON, and the exact committed test control flow, not step conclusions.
- `scatter-nan-size` reaches the reader and throws exactly `run_matlab_gate:ComparisonProofHandles`. The prior MATLAB setter failure `PositiveOrNanVectorDataPredicate` is absent from all three complete job logs.
- All three complete logs contain no prior deleted-handle/`restore_properties`/`onCleanup` failure signatures. This demonstrates their absence on this completed run, not a separately forced exceptional-unwind test.
- Warnings remain in the two flat-alpha mutations: R2021a reports `Error updating Scatter. Data lengths must match.`; R2024b and R2026a report `Error in state of SceneNode. Data lengths must match.` Each warning is followed by the expected reader rejection and does not substitute for that rejection.

## Actual Log Evidence

Line numbers are one-based in the complete bytes returned by `gh api repos/wzn1118/ocean-intelligence/actions/jobs/<job>/logs`.

| Release / job | NaN rejection line | Last rejection line | Count / completion lines | Completion UTC |
| --- | ---: | ---: | --- | --- |
| R2021a / 101397614005 | 982 | 1055 | 1056 / 1057 | 00:05:06.6727733 |
| R2024b / 101397614087 | 1034 | 1105 | 1106 / 1107 | 00:05:13.3694905 |
| R2026a / 101397614010 | 1040 | 1111 | 1112 / 1113 | 00:09:17.9814089 |

The actual terminal markers are `COMPARISON_NATIVE_READER_TEST_NEGATIVES=36` and `COMPARISON_NATIVE_READER_TEST=passed_synthetic_native_mutations_only`.
In each release, all 36 distinct `COMPARISON_NATIVE_REJECTED=<case>:<identifier>` records match completion JSON and the committed expected names, identifiers, and order exactly.
Coverage: 19 property mutations, two extra objects, two wrong parents, one wrong exported figure, and 12 returned-record/uncertainty/QC/pairing/handle/metric mutations.
The last rejection is `metric-bias-changed:run_matlab_gate:ComparisonProofMetrics` in all three logs.
Flat-alpha warning/rejection locations: R2021a 986/1001 and 1003/1018; R2024b 1038/1052 and 1054/1068; R2026a 1044/1058 and 1060/1074. Their stacks enter `measure_comparison_plot_data` line 87 during the reader call.

## Restoration and JSON

The exact committed `codex-runtime/matlab/tests/test_comparison_native_evidence.m` was retrieved from GitHub, not assumed from current workspace state; its SHA-256 is `4ad842e4dce727264f822e9fa50825dfecf320d01abc65d891f9cee99cdb65cd` (21198 bytes).
In that source, each negative case is followed by restored-baseline equality; line 253 performs final `isequaln(reader(result), baseline)` after clearing the extra-figure and legend cleanup objects.
Lines 254-257 then assert equality of all six exported-file hashes and the consumed fixture hash. Only afterward do lines 268-270 write completion JSON and emit the two terminal markers.
There is no separate final-restoration or final-hash log marker: completion is established by this source ordering plus the real terminal markers and JSON, not by inventing additional markers.
All three `native-reader-test-results.json` files parse, contain exactly 36 negative records, declare `original_artifacts_unchanged=true`, and retain `visual_verified=false` and `desktop_interaction_verified=false`.
The four positives are `exported-baseline`, `exported-char-title-numeric-alpha`, `flat-rgb-numeric-alpha`, and `edge-only-numeric-alpha`; the native title getter is `char`, size `[2,51]`, in all three releases.
Independent SHA-256 reads match every reported PNG/PDF/SVG hash for `native-reader-baseline` and `native-reader-char-title` (6/6 per release). The consumed input hash also matches completion JSON and the schema-3 baseline declaration.
R2026a's complete negative-case array was compared with the previously verified, hash-bound R2021a JSON and independently with its own 36 raw-log rejections; names, identifiers, and order match exactly. Its terminal markers and JSON follow the same final-restoration and file-hash assertions described above.
This proves restoration of the reader's complete evidence and preservation of the recorded files; it is not a pixel-equivalence claim for all mutable graphics state.

## Hash Anchors

| Evidence | Bytes | SHA-256 |
| --- | ---: | --- |
| R2021a full job log | 774518 | `bfcd98e1e4d2fe7e1fc54a8b123f5ba2acb9502c59327020e5d43623ac18f253` |
| R2024b full job log | 780225 | `809914265115b2762d773994f1eed011e95556075addf1b62fd0b05dea48fb82` |
| R2026a full job log | 876351 | `a30105faa046d081cb4e18d2ae02bfbfa2bc2966cb7462ca95cf6f1902bdd4b0` |
| R2021a native-reader-test-results.json | 4205 | `151810c5191874dd0eacaa461c127af53ef30673908aaedb552f7debf24c90f3` |
| R2024b native-reader-test-results.json | 4205 | `caa2a5a5ebe0b036cc63a4f2b138545f395428aada5d357e350efaf07c6c34ac` |
| R2026a native-reader-test-results.json | 4205 | `79a665323efc4bed41f2f481d376d7c0c5d4a7590132cfc1c29390a326da31f2` |
| R2021a baseline-test-evidence.json | 4168 | `7bf3cce9a36e2eec47b74b790fcdfb5c2c5ad3569e7524aaf6f5547a73fcf67a` |
| R2024b baseline-test-evidence.json | 4168 | `0f002fb1cb62e3ca97d9a990b79acdf93d92e856c8f58a76d1d0d9a055673233` |
| R2026a baseline-test-evidence.json | 4168 | `79cb9d2b29a2e077173b7e043f33ec7091144d54968d44b7e9e5206ffeca346f` |
| All three paired_observation_model.input.json | 2771 | `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b` |

Across the initial review and this R2026a supplement, before/after inventories cover every original package file, including the six exports per suite: R2021a 301 files, R2024b 321 files, R2026a 351 files; all 973 unchanged during their respective reviews.
Inventory digest definition: SHA-256 of UTF-8 `json.dumps(files, sort_keys=True, separators=(',', ':'))`, where `files` maps package-relative POSIX paths to `{bytes, sha256}`.
R2021a before = after: `b96156f8b5ee09fea11dbadcfeccc03c99633c82459f8b5859ff6f465cb6aad1`.
R2024b before = after: `f6015d892f7533994ebceefbee78b55617e1f08078283169d38b6e02eae34758`.
R2026a before = after: `914393714b50afa9cc40afe80291e60714e2d7bdd4a39239d1e30e53b0638e50`.

## Limits

No local MATLAB execution, rendering, visual audit, Desktop interaction, score changes, or source/original edits occurred. The verified result is this synthetic native adversarial suite on R2021a/R2024b/R2026a only; it does not certify overall CI, production observations, PDF font quality, or Desktop/visual quality.
