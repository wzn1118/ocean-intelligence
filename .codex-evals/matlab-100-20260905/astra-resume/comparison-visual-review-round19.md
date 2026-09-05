# Round 19 comparison visual review: CI 33997547843

## Findings

- **P1: R2021a and R2024b evaluator PDFs clip the main title at the right page edge.** The intended ending is `stable identities`; external PDF extraction ends at `stable identiti`, and the rendered page visibly cuts the text. Their PNG/SVG main titles fit. This is a format-specific defect, not a missing fixture.
- **P1: R2021a evaluator PNG/PDF/SVG obscure the lower part of `Observation (degC)` with the legend background/top border.** The first line of native `Legend.Title` also crosses the legend sides. The PDF additionally overflows its second legend-title line slightly on the right.
- **P2: All four older-release PDFs overflow the first legend-title line to the right and run the `Paired samples` label into the dashed reference key.** The R2024b evaluator and both helper PNG/SVG outputs do not show these PDF defects. The older PDFs use unembedded Courier rather than the selected WenQuanYi font; font substitution and layout failure coexist, but this inspection does not isolate a causal fix.
- **R2026a was inspected independently:** neither figure shows the preceding title clipping, legend overflow, or xlabel occlusion in its PNG, PDF, or librsvg preview. This is a limited observation of these six artifacts, not a general visual pass. Short, pale uncertainty lines and overlapping evaluator markers remain difficult to distinguish.

## Scope and method

- Only two synthetic figures per release: E = `paired-observation-model` in `evaluator-runtime`; H = `synthetic-observation-uncertainty` in `family-b/comparison-uncertainty`. Exact source links are below. No real-ocean interpretation, scientific-array/statistic recomputation, source-binding re-evaluation, or trusted-human signature is performed.
- Each release's `ci-stage-status.json` records 19/20, with evaluator-runtime passed and family-b-runtime failed on `test_comparison_record_metadata:MissingRejection` (`Expected oi_plot_comparison rejection containing SampleLabels`). The earlier H helper artifacts and manifest exist in all three releases despite that later stage failure. Script/schema/external gate results are not used as visual approval.
- Actually viewed all six original PNGs and all twelve independently rendered PDF/SVG previews. Poppler 22.02.0 supplied `pdftoppm`, `pdftotext -bbox-layout`, `pdfinfo -box`, and `pdffonts`. Existing isolated `/tmp/svg-derived-pdf-round19-tqf6v5/tool/usr/bin/rsvg-convert` is librsvg 2.52.5; no SVG rewriting or custom stylesheet was used.
- Derived previews are in `/tmp/comparison-visual-round19-2c1SqA`, each 1600x1000: PDF via `pdftoppm -png -singlefile -scale-to 1600`; SVG via `rsvg-convert --format=png --dpi-x=96 --dpi-y=96 --width=1600 --keep-aspect-ratio`. These are inspection derivatives, not native exports or independent-browser evidence.
- All 18 artifact SHA-256/byte pairs match their corresponding manifest entry. Raw PNGs are 2400x1500 with 11811 pixels/metre in both dimensions (299.9994 DPI); PDFs have one 576x360-point page. SVG roots declare 2400px x 1500px, native `viewBox="0 0 576 360"`, physical 8x5 inches, and 8in/5in style dimensions. Different SVG coordinate/pixel sizes are preserved, not treated as a mismatch.

## Per-figure inspection

Here, "fits" means no indicated text loss/overlap was observed in this render, not a complete geometry or visual certification. All figures retain readable statistics and y-axis units. The specific x-axis and title exceptions are listed explicitly.

| Figure | Original PNG | Original PDF and rendered preview | Original SVG and librsvg preview |
| --- | --- | --- | --- |
| R2021a E | [PNG](/tmp/matlab-run-33997547843/matlab-full100-R2021a/evaluator-runtime/paired-observation-model.png): xlabel masked; legend-title first line crosses frame. | [PDF](/tmp/matlab-run-33997547843/matlab-full100-R2021a/evaluator-runtime/paired-observation-model.pdf), [preview](/tmp/comparison-visual-round19-2c1SqA/R2021a-evaluator-pdf.png): main title page-clipped, xlabel masked, both legend-title lines overflow, key collision. | [SVG](/tmp/matlab-run-33997547843/matlab-full100-R2021a/evaluator-runtime/paired-observation-model.svg), [preview](/tmp/comparison-visual-round19-2c1SqA/R2021a-evaluator-svg.png): main title fits; xlabel masked and first legend-title line overflows. |
| R2024b E | [PNG](/tmp/matlab-run-33997547843/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.png): title, statistics, axes and two legend-title lines fit. | [PDF](/tmp/matlab-run-33997547843/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.pdf), [preview](/tmp/comparison-visual-round19-2c1SqA/R2024b-evaluator-pdf.png): main title page-clipped; first legend-title line overflows and key collides; xlabel fits. | [SVG](/tmp/matlab-run-33997547843/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.svg), [preview](/tmp/comparison-visual-round19-2c1SqA/R2024b-evaluator-svg.png): title, statistics, axes and legend fit. |
| R2026a E | [PNG](/tmp/matlab-run-33997547843/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.png): title, statistics, axes and legend fit; short U segments are faint beside overlapping markers. | [PDF](/tmp/matlab-run-33997547843/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.pdf), [preview](/tmp/comparison-visual-round19-2c1SqA/R2026a-evaluator-pdf.png): full main title, both legend-title lines and xlabel fit; no reference-key collision observed. | [SVG](/tmp/matlab-run-33997547843/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.svg), [preview](/tmp/comparison-visual-round19-2c1SqA/R2026a-evaluator-svg.png): same limited text-fit observation, independently viewed. |
| R2021a H | [PNG](/tmp/matlab-run-33997547843/matlab-full100-R2021a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.png): title, statistics, axes and legend fit; all three points visible. | [PDF](/tmp/matlab-run-33997547843/matlab-full100-R2021a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.pdf), [preview](/tmp/comparison-visual-round19-2c1SqA/R2021a-helper-pdf.png): main title/xlabel fit; first legend-title line overflows, key collides. | [SVG](/tmp/matlab-run-33997547843/matlab-full100-R2021a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.svg), [preview](/tmp/comparison-visual-round19-2c1SqA/R2021a-helper-svg.png): title, statistics, axes and legend fit. |
| R2024b H | [PNG](/tmp/matlab-run-33997547843/matlab-full100-R2024b/family-b/comparison-uncertainty/synthetic-observation-uncertainty.png): title, statistics, axes and legend fit; all three points visible. | [PDF](/tmp/matlab-run-33997547843/matlab-full100-R2024b/family-b/comparison-uncertainty/synthetic-observation-uncertainty.pdf), [preview](/tmp/comparison-visual-round19-2c1SqA/R2024b-helper-pdf.png): main title/xlabel fit; first legend-title line overflows, key collides. | [SVG](/tmp/matlab-run-33997547843/matlab-full100-R2024b/family-b/comparison-uncertainty/synthetic-observation-uncertainty.svg), [preview](/tmp/comparison-visual-round19-2c1SqA/R2024b-helper-svg.png): title, statistics, axes and legend fit. |
| R2026a H | [PNG](/tmp/matlab-run-33997547843/matlab-full100-R2026a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.png): title, statistics, axes and legend fit; all three points visible. | [PDF](/tmp/matlab-run-33997547843/matlab-full100-R2026a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.pdf), [preview](/tmp/comparison-visual-round19-2c1SqA/R2026a-helper-pdf.png): both legend-title lines fit, no key collision; narrow top margin but no observed title crop. | [SVG](/tmp/matlab-run-33997547843/matlab-full100-R2026a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.svg), [preview](/tmp/comparison-visual-round19-2c1SqA/R2026a-helper-svg.png): same limited text-fit observation, independently viewed. |

## Defect localization

PDF text coordinates below are external extracted bounding boxes in points, with origin at the page's top-left; page size is 576x360. Frame coordinates are approximate pixels in the linked 1600x1000 previews. Neither is a MATLAB native bound, and neither is written back to a manifest.

| PDF | Extracted main title x / y | First legend-title line x / y | Approximate legend frame in preview: x / y |
| --- | --- | --- | --- |
| R2021a E | 120.500..580.700 / 43.073..53.291; truncated | 184.500..490.500 / 263.098..270.958 | 533..1114 / 719..834; title right edge about 1363, outside frame |
| R2024b E | 120.500..580.700 / 43.073..53.291; truncated | 185.000..491.000 / 280.710..288.570 | 503..1147 / 761..897; title right edge about 1364, outside frame |
| R2026a E | 121.680..472.872 / 38.337..54.664; complete | 192.600..401.677 / 282.940..294.731 | 506..1144 / 782..898; line inside frame |
| R2021a H | 185.500..481.900 / 10.073..20.291; complete | 181.000..487.000 / 305.710..313.570 | 491..1136 / 830..967; title right edge about 1353, outside frame |
| R2024b H | 183.500..479.900 / 10.073..20.291; complete | 179.000..485.000 / 305.710..313.570 | 486..1131 / 830..967; title right edge about 1347, outside frame |
| R2026a H | 183.960..397.832 / 5.937..22.264; complete | 186.480..395.557 / 307.420..319.211 | 488..1128 / 850..966; line inside frame |

R2021a E's PDF xlabel is extractable at x=251.000..369.800, y=254.089..262.735 points, but the legend fill starts around y=259 points and visibly hides its lower strokes. Extraction alone therefore does not establish readability. Its original PNG defect is isolated in the unscaled crop below, source rectangle `[700,1000,1800,1300]` in top-left-origin pixels; the original remains unchanged.

![R2021a evaluator original-PNG crop: xlabel hidden behind legend and title crosses frame](/tmp/comparison-visual-round19-2c1SqA/R2021a-evaluator-png-legend-detail.png)

## Uncertainty and text scope

- All 18 outputs visibly retain `Horizontal: observation standard uncertainty (degC)` and `Model uncertainty not provided`, even where text crosses the legend frame. No supplied-model-U interpretation is justified. The legend title is visibly two lines, not two newly substituted ordinary text objects.
- H provides the finite missing-U visual positive: three markers near (1,1.5), (2,2.5), (3,3.5) remain in every format/release; the middle marker at (2,2.5) has no horizontal uncertainty segment. Both other horizontal segments remain visible, and the long segment has approximately 23-26 pixels of clearance from the left/right axes edges in the 1600-pixel-wide PDF/SVG previews. No endpoint crop was observed. Their pale stroke resembles the grid, so legibility remains weaker than marker legibility.
- E is not an independent positive for retention of an accepted finite pair with missing U: its declared missing-U row 12 is absent from the native scatter record list. Filtering causality and scientific record bindings are left to the separate array audit. Visible plotted intervals are inside the axes, but short segments and overlapping circles do not allow this review to certify all eleven identities or U lengths individually.
- The three E statistic lines visibly report N=11, Bias=0.08727 degC, MAE=0.09273 degC, RMSE=0.1116 degC, r=1.000, missing/QC=1/0, unmatched=0/0. H reports N=3, Bias=MAE=RMSE=0.5 degC, r=1.000, missing/QC=2/1, unmatched=1/1. These are text-presence observations, not recalculated statistics.

## Evidence consistency

- All six relevant entries inventory one unmeasured object with exact role `legend.title`, class `matlab.graphics.illustration.legend.Text`, font `WenQuanYi Zen Hei`, size 10, and `geometry_status="unverified"`; its flattened string contains both displayed lines. The object has no fabricated bounds. Main title/subtitle/axis-label native font sizes are 13/10/11 points; those native selections do not prove the exported font face or width.
- Each entry retains `rendering_evidence.bounds_audited=true`, `bounds_audit_scope="measured_objects_only"`, `bounds_audit_complete=false`, `unmeasured_count=1`, and `publication.layout.stable=false`. Reported zero clipped/overlap counts are not a per-format whole-canvas guarantee: the independently observed PDF clipping and legend occlusion still exist.
- All six entries keep visual inspection, PDF embedding and glyph-rendering verification false; top-level visual inspection is `not_run`/false. CJK text-present is false, consistent with these English-only figures. No CJK rendering conclusion follows from the candidate font name.
- `pdffonts` on all four R2021a/R2024b PDFs reports only Courier, Type 1 / WinAnsi, with emb/sub/uni all no. Both R2026a PDFs report WenQuanYiZenHei, CID TrueType / Identity-H, emb=yes, sub=no, uni=yes. This external embedding observation does not mutate or upgrade the native manifest's false flag.
- Older SVGs contain zero XML text nodes but render outlined text correctly except for the recorded layout defects. R2026a E/H contain 18/23 text nodes and name WenQuanYi Zen Hei; no `font-face` elements were found. Local librsvg rendering is not evidence of embedded SVG fonts or portability to another font environment.
- Relevant export APIs match the recorded runtime: print for the older releases, exportgraphics for R2026a. No artifacts were regenerated by MATLAB here, and no score, weight, gate or self-rating was used to erase the observed defects.

## Immutable source snapshot

The table records identical **before and after** SHA-256 and byte counts for all 27 reviewed originals: 18 artifacts, six manifests and three stage records. E/H refer to the exact source folders and artifact stems linked above; `manifest` is that folder's `figures.json`; `stage` is the release-root `ci-stage-status.json` under `/tmp/matlab-run-33997547843/matlab-full100-RELEASE`. No source bytes changed during inspection.

| Release | Source | Bytes | SHA-256, before = after |
| --- | --- | ---: | --- |
| R2021a | stage | 5078 | `9add5fae4dc9a66158b57ae8e069185e83b6fc95c4c2e01da4cb684d9743d1b8` |
| R2021a | E manifest | 70118 | `357a544a3bc73c6a6c1519881b6a1086255db9a07c55d560f3e5c86bf76b5edd` |
| R2021a | E PNG | 131640 | `e3faf7e2e9338c371a6e9b1211bc540e36a2047b29d19178255a03cf49e2d7ea` |
| R2021a | E PDF | 4109 | `8a48a70bbbbdfc99e8f2acf172cf8234e7e6312ebaf32d180c051192aa3b4455` |
| R2021a | E SVG | 173673 | `8f046204125ebd3a4aaf085290ab97889e9e7a8ef8a7f58e1ec6fb732c726a5f` |
| R2021a | H manifest | 17598 | `5d0b3ca44ac9e0b2c7fe2abb46902cde0208f5bff40535e3ea969442e6caa808` |
| R2021a | H PNG | 126293 | `4d8aa7e4dfe41528c2312f96498acdb93f90d26440c1e509b02ac925f734542f` |
| R2021a | H PDF | 3415 | `c3c5eaf3d7d9777e763126a8ad0232f43a41b3e8f7a94feba6b8e3481cad89d9` |
| R2021a | H SVG | 145161 | `a88d70bdc36eec85247f5f58d7c4efc2fe9b40b29867ad4010e0bd6efe1df943` |
| R2024b | stage | 5645 | `3c84026e683fefa18c6ce26f05f3f9b12ca003dc00830d9d0c421d1094491549` |
| R2024b | E manifest | 70119 | `8e095c08af5ceea7f4e141adafbae01963cdffd88278866beabea7207da650a2` |
| R2024b | E PNG | 137384 | `689675b95c43e8238f780d91c8909047b51ca335d5cc30286211dccb4b1df7ab` |
| R2024b | E PDF | 4061 | `7a69e936428867cf21e0dd516bbab85b0614b775c02286995859e28f7c49f420` |
| R2024b | E SVG | 173662 | `92a6fc9212a9aa72ce343e6966c1a5d8cf58e52f64698a7b6c052a520a657c07` |
| R2024b | H manifest | 17594 | `7acd478cd0e13a8f74842b7b04d41bf691e944976f756d0c26b763527f2419d4` |
| R2024b | H PNG | 128322 | `9186fafef32cf1b1ecb03fc655c081f1b75076e623f936c8333d83078dbbbbbd` |
| R2024b | H PDF | 3415 | `d599fbd39188b67092f702aa91683070f658710f5a5aeb5e9ffc82020dd6cd89` |
| R2024b | H SVG | 145161 | `8e1b2eb3e8d1f8416c2c2bf0b76534737ca35ab3bfca29468cda9dad10dfee13` |
| R2026a | stage | 5645 | `07ea2ab3041f98ee078cef187cacc4c5a377c936a8f62185e29dc6f8a4709135` |
| R2026a | E manifest | 70092 | `e5179efc2c122ab7e58e9a163ba2642c5add68361b6b9ce934832a4b26ed3d18` |
| R2026a | E PNG | 164023 | `5d9fa6ca34d904f3c21a1c8f0a80968877cea2a187b76d5a74a132dcfd19a6dd` |
| R2026a | E PDF | 15421 | `326f609b1cf2ffc93e8d717ff7bac3ef3111e2c3fd0229f8d7be168105baaece` |
| R2026a | E SVG | 32157 | `e562a32692a0d4f98d2aadf9cfa7acdc5a3cf792a52753e20983933d525d8828` |
| R2026a | H manifest | 17630 | `d164cab77455f522fc25daa3a4f70599f5ff6bb43cd395f7850916d8d50f57ff` |
| R2026a | H PNG | 153666 | `44f0b2a33313cc8beeba59476e8ab64a506405d29639fb7bed94dbb41511b712` |
| R2026a | H PDF | 13443 | `6d36bc9d79c63b51956c3dbc87971cd5bdf570a515a5483edcae1bba4ad7a007` |
| R2026a | H SVG | 28317 | `7c2d4d59aede44402b368dc63ba44c8b8c30148098c9502efa1cc9227f242da5` |

Only this report is added to the repository; temporary inspection images are separate derivatives. No production/test/score/freeze files or original artifacts were edited, no commit was made, and no trusted-human visual status is signed.
