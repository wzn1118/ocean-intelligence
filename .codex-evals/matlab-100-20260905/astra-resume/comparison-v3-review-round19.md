# Round 19: comparison v3 and observation-only uncertainty

Reviewed CI run `33997547843`, commit `ac97b7419ccb6ae704f259a633ccf0a6608d39cc`.
Original packages: `/tmp/matlab-run-33997547843/matlab-full100-{R2021a,R2024b,R2026a}`.
Read-only checks used JSON/XML parsers, SHA-256, Pillow, Poppler and CairoSVG 2.9.0. No local MATLAB execution, native mutation replay, Desktop validation, source change, score change or `visual_verified` promotion occurred.

## Findings and execution boundary

| Release | Native stages | Raw score/status | Evaluator stage | Consumer declarations | External artifact audit |
| --- | --- | --- | --- | --- | --- |
| R2021a | 19/20, failure | 90 / runtime_pending | passed | 4/4 verified | 8/12; four PDFs fail font embedding |
| R2024b | 19/20, failure | 90 / runtime_pending | passed | 4/4 verified | 8/12; four PDFs fail font embedding |
| R2026a | 19/20, failure | 90 / runtime_pending | passed | 4/4 verified | 12/12 automated checks |

- The matrix is **57/60, failure**, not an overall 100-point or publication-quality pass.
- All three original `ci-stage-status.json` files retain `test_comparison_record_metadata:MissingRejection`: `Expected oi_plot_comparison rejection containing SampleLabels`. The stack reaches `test_negative_labels` line 442 and `full100_family_b_runtime` line 106. The coordinator's cellstr test correction is not evidence that the corrected test ran in this snapshot.
- **R2021a evaluator comparison PNG has a real layout defect:** the legend top border overlaps the bottom of `Observation (degC)` and the first legend-title line extends outside the legend frame. The original SVG and PDF previews reproduce the defect. R2024b/R2026a comparison PNG/SVG previews do not show this collision.
- **Both old-release comparison PDFs clip the long title at the right page boundary.** Poppler extraction ends at `stable identiti`; rendered pages confirm clipping. Their comparison and independent-U PDFs also have legend-title overflow and a reference-line key colliding with `Paired samples`. `pdffonts` reports unembedded Courier, not the selected WenQuanYi font. These failures remain unresolved.
- R2026a comparison/U PDF font inventories contain embedded `WenQuanYiZenHei` with a Unicode map; the inspected previews retain titles and legend explanations. This scoped observation and external 12/12 are not a complete visual or CJK validation.

## Complete v3 records

All three comparison declarations are schema 3, shape `[12]`, dimension order `observation`; their record, pairing, QC, scatter and U structures are identical across releases. Statistics agree within `1e-12`.
The consumed `evaluator-runtime/fixture-inputs/paired_observation_model.json` is 2771 bytes in each package, SHA-256 `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b`.
Every source value was compared against the consumed fixture, not regenerated from its formula or inferred from labels. IDs are `pair-001` through `pair-012`; source rows are 1 through 12 in `call_entry_order`. Times below are on `2026-08-20`, UTC; depth is metres, positive down. All temperatures and standard-U magnitudes are `degC`.

| Source row / ID suffix | UTC time | Depth | Observation | Model | Observation U | QC | Native horizontal X endpoints |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 / 001 | 00:00:00 | 10 | 17.02 | 17.10 | 0.10 | good | [16.92, 17.12] |
| 2 / 002 | 00:00:00 | 40 | 15.37 | 15.51 | 0.12 | good | [15.25, 15.49] |
| 3 / 003 | 00:00:00 | 70 | 13.72 | 13.93 | 0.15 | good | [13.57, 13.87] |
| 4 / 004 | 06:00:00 | 10 | 17.31 | 17.35 | 0.10 | good | [17.21, 17.41] |
| 5 / 005 | 06:00:00 | 40 | 15.66 | 15.76 | 0.12 | good | [15.54, 15.78] |
| 6 / 006 | 06:00:00 | 70 | 14.01 | 14.18 | 0.15 | suspect | [13.86, 14.16] |
| 7 / 007 | 12:00:00 | 10 | 17.38 | 17.39 | 0.10 | good | [17.28, 17.48] |
| 8 / 008 | 12:00:00 | 40 | 15.73 | 15.80 | 0.12 | good | [15.61, 15.85] |
| 9 / 009 | 12:00:00 | 70 | 14.08 | 14.22 | 0.15 | good | [13.93, 14.23] |
| 10 / 010 | 18:00:00 | 10 | 17.16 | 17.13 | 0.10 | good | [17.06, 17.26] |
| 11 / 011 | 18:00:00 | 40 | 15.51 | 15.54 | 0.12 | good | [15.39, 15.63] |
| 12 / 012 | 18:00:00 | 70 | null | **13.96** | null | missing | none |

Endpoint decimals above are displayed rounded; raw floating-point endpoints were checked against `observation +/- U` within `1e-12`. Every segment has `Y=[model,model]` and the matching source row/ID. All 11 Scatter X/Y values match the accepted records, including suspect row 6. Missing observation row 12 retains its model, identity, time and depth but creates neither scatter nor interval.
The finite-pair, QC-accepted, paired and U-graphics masks are true for rows 1-11 and false for row 12. Pairing is row-aligned with indices 1-12 and zero unmatched rows. Observation QC accepts good/suspect; model QC and model U are exactly `status=not_provided`, without invented arrays. U is `standard-uncertainty`, magnitude, horizontal-line-segments, confidence level null, not a joint confidence interval.
Independent fixture arithmetic confirms N=11, bias `0.08727272727272767`, MAE `0.09272727272727334`, RMSE `0.11159993483217405`, Pearson r `0.9996003539344701`; observation-U error coverage is 8/11.

## Independent U test really completed

CI-source retrieval confirmed `test_comparison_uncertainty.m` equals the inspected local file, SHA-256 `ea496fedd203b21fc93ebe22c877af2b8b093e414221c7aa45be120ba3526128`. The committed runner also matches locally; lines 105-107 call U, metadata, then `test_comparison_native_evidence`, without an intervening catch.
The complete job logs contain the final `MATLAB_COMPARISON_UNCERTAINTY_NATIVE_ASSERTIONS=passed` marker followed by `MATLAB_COMPARISON_UNCERTAINTY_VISUAL_VERIFIED=false` and the manifest path:

| Release / GitHub job | Passed-marker line and UTC time | Whole job-log SHA-256 |
| --- | --- | --- |
| R2021a / 101390679606 | 971; 23:05:12.3224592 | `52b5ca168bef22a1ff4a127d06783e248c7bb55b24dca6546073a68f72503bea` |
| R2024b / 101390679542 | 973; 23:05:20.1027766 | `7e76b6ac3d4109d993b1ae77c71d685e3eda6432f30376c2ea23bfcd5d90e3f8` |
| R2026a / 101390679586 | 1019; 23:08:02.3999820 | `a203363456bf6f6c589b341d729a6457d5129af67625588114b266b5b227b88b` |

These markers follow the U test's final native-array, negative-contract, role-audit, input-preservation, post-export, manifest/hash and verification-scope assertions. Thus the complete **independent U test** passed on all three releases, despite the enclosing family-b stage failing afterward. Its targeted role-removal checks must not be conflated with the later, **unexecuted** `test_comparison_native_evidence` v3 tampering suite.
Each `family-b/comparison-uncertainty/figures.json` binds three real exports. Rechecked native scatter is X=`[3,1,2]`, Y=`[3.5,1.5,2.5]`; only two horizontal segments exist, `[-1,7]` at Y=3.5 and `[-1,3]` at Y=1.5. Finite suspect sample B at `(2,2.5)` survives missing U. Missing-model and rejected-QC magnitudes 100 and 50 remain inputs but do not create intervals. Model U remains absent; both explanatory legend-title lines are retained.

## Actual files and consumer scope

- Inspected six original PNGs and external previews of the corresponding six original PDFs and six SVGs: evaluator comparison plus independent U on each release. U PNG/SVG previews show both complete horizontal intervals, the finite missing-U point and readable title/legend text; their old PDFs retain the plotting data but exhibit the legend defects above. Short overlapping intervals in the v3 comparison are not independently countable by eye; the 11-endpoint result is a native-declaration/fixture check.
- All six PNG headers measure 2400x1500, with embedded DPI 299.9994 on both axes. All six actual PDFs have one 576x360 pt page and MediaBox/CropBox `[0,0,576,360]`, i.e. 8x5 inches. No PDF box was edited.
- All six SVG roots parse as XML: `width=2400px`, `height=1500px`, `viewBox="0 0 576 360"`, physical metadata 8x5 in and CSS `width:8in;height:5in`. CSS intrinsic display is 768x480 CSS px at 96 DPI, distinct from the target raster dimensions. Old SVG glyphs are paths with zero text elements; readable previews are not searchable-text evidence. R26 has actual text elements retaining both legend explanations.
- Recorded APIs are `print` for all three formats on R21/R24 (`-dpng -r300`, `-dpdf -painters`, SVG device `-dsvg`) and `exportgraphics` on R26. Rendering the existing vectors for inspection is not another MATLAB export. Temporary 1200x750 previews live only under `/tmp/comparison-v3-round19-review-jghy18bv`; originals were never rewritten.
- Both comparison and U manifests explicitly retain `bounds_audit_complete=false`, `unmeasured_count=1` for `legend.title`, and visual verification false. Native text assertions and the separate passed text-bounds stage do not certify these exported legend layouts.
- Rehashed all 36 evaluator exports against both their manifests and report evidence, plus all nine independent-U exports against their manifests. Rechecked all consumed fixture hashes, runtime/manifest/report bindings and external-audit source/artifact bindings. `ocean-report.log` hashes match the actual Markdown and evidence JSON on each release.
- Each report consumer has `status=passed`, fixture binding verified, and all four figure entries `runtime_declaration_verified` with `local_arrays_match=true` and `input_fixture_binding_verified=true`. Schemas are field=1, interactive=2, comparison=3, profiles=1. These are synthetic runtime declarations, not authenticated replay, real-area observations or complete visual verification.
- The same CI snapshot contains PNG/PDF/SVG figure files, `report.md` and `report-evidence.json`. It contains **no HTML, DOCX or report PDF**. Four verified figures must not be described as a new four-format report/HTML validation. No later local conversion was substituted for missing CI evidence.
- Per coordinator update, the separate Astra attempt ended after about four minutes/seven network retries at its timeout, without a model reply, while system-CA/TLS work continued. This review did not repeat that diagnosis and does not record Astra success.

## Original-byte preservation and anchors

Every package file was hashed before semantic inspection and again after rendering. All 937 paths, byte counts and hashes are unchanged. Inventory digest is SHA-256 of UTF-8 `json.dumps(files, sort_keys=True, separators=(',', ':'))`, with package-relative POSIX keys and `{bytes, sha256}` values.

| Release | File count | Before = after inventory SHA-256 |
| --- | --- | --- |
| R2021a | 309 | `05246a78ca49796c9979ce154f3fff5695a234af2d500bb064b55e9a008235c5` |
| R2024b | 297 | `2643555bcacbeae740166881ec4e65676cfe814e7705d0dbd0129613d544faee` |
| R2026a | 331 | `2ab9e725bcd9a545ba81208fdee13b0ae9943157fe3f73a91bbf48049fa07588` |

`E` below is `evaluator-runtime`; `U` is `family-b/comparison-uncertainty`, relative to the release package.

| Release | Evidence file | Bytes | SHA-256 |
| --- | --- | --- | --- |
| R2021a | E/figures.json | 70118 | `357a544a3bc73c6a6c1519881b6a1086255db9a07c55d560f3e5c86bf76b5edd` |
| R2024b | E/figures.json | 70119 | `8e095c08af5ceea7f4e141adafbae01963cdffd88278866beabea7207da650a2` |
| R2026a | E/figures.json | 70092 | `e5179efc2c122ab7e58e9a163ba2642c5add68361b6b9ce934832a4b26ed3d18` |
| R2021a | E/report-evidence.json | 128259 | `da92757fbb1388d95c6b604b1206f344559e4fd8a32d4d12736a9298d80128d8` |
| R2024b | E/report-evidence.json | 128278 | `fc6287f87d5e85df838d4d94f2a3de0bbfadbde210dd9a53eee9db5c00ced602` |
| R2026a | E/report-evidence.json | 128284 | `f43e7f07d957788dbbf7c9051871a5861d21cd5431a90e03c94f9f8c317b386b` |
| R2021a | U/figures.json | 17598 | `5d0b3ca44ac9e0b2c7fe2abb46902cde0208f5bff40535e3ea969442e6caa808` |
| R2024b | U/figures.json | 17594 | `7acd478cd0e13a8f74842b7b04d41bf691e944976f756d0c26b763527f2419d4` |
| R2026a | U/figures.json | 17630 | `d164cab77455f522fc25daa3a4f70599f5ff6bb43cd395f7850916d8d50f57ff` |
| R2021a | E/paired-observation-model.png | 131640 | `e3faf7e2e9338c371a6e9b1211bc540e36a2047b29d19178255a03cf49e2d7ea` |
| R2021a | E/paired-observation-model.svg | 173673 | `8f046204125ebd3a4aaf085290ab97889e9e7a8ef8a7f58e1ec6fb732c726a5f` |
| R2021a | E/paired-observation-model.pdf | 4109 | `8a48a70bbbbdfc99e8f2acf172cf8234e7e6312ebaf32d180c051192aa3b4455` |
| R2024b | E/paired-observation-model.pdf | 4061 | `7a69e936428867cf21e0dd516bbab85b0614b775c02286995859e28f7c49f420` |
| R2026a | E/paired-observation-model.pdf | 15421 | `326f609b1cf2ffc93e8d717ff7bac3ef3111e2c3fd0229f8d7be168105baaece` |

Next evidence needed: a fresh CI run reaching the corrected metadata test and the separate v3 native-tampering suite; exported legend-layout and old-PDF font/title corrections must be checked on new original bytes before any visual approval. This report does not change those tests, exports or gates.
