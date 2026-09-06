# Round 20 native char-title visual review: run 33999054663

## Findings

- **The two legend-title lines survive in both states, all three formats, all three releases.** The char-matrix state does not produce a new visible padding glyph, remove the second line, or introduce an observed additional crop. It is not visually identical: `Model uncertainty not provided` moves left by 31.50 PDF points on R2021a/R2024b and 29.16 points on R2026a. The first line stays in place. R2026a SVG explicitly retains 21 trailing spaces on the second line with `xml:space="preserve"`; the changed alignment is consistent with those retained spaces, not evidence that padding was removed.
- **Scatter remains visibly present, with genuinely changed paint in every paired format.** The char-title markers and legend sample are lighter and have weaker outlines. This is a combined color/alpha change, not a pure-alpha experiment or a same-pixel export; local image comparisons and serialized SVG paint corroborate the viewed difference.
- **P1, existing defects remain:** both R2021a/R2024b PDFs in both states clip the main title at the page's right edge. R2021a PNG/PDF/SVG in both states obscure the lower part of the x-axis label behind the legend and overflow the first legend-title line beyond the frame.
- **P2, existing PDF legend defects remain:** all four older PDFs overflow the first legend-title line on the right and run `Paired samples` into the dashed reference key. The R2021a baseline PDF also overflows the second line slightly; its char-title left shift brings that line inside, without fixing the other defects.
- **R2026a was added after its package arrived and independently viewed:** no corresponding title crop, legend overflow, or xlabel masking was observed in either state/format. This is only this synthetic comparison pair, not general layout, CJK, all-marker readability, or trusted visual approval.

## Scope and method

- Exact directories, confirmed with `rg`: `/tmp/matlab-run-33999054663/matlab-full100-R2021a/family-b/comparison-native-evidence-adversarial-test`, `/tmp/matlab-run-33999054663/matlab-full100-R2024b/family-b/comparison-native-evidence-adversarial-test`, and `/tmp/matlab-run-33999054663/matlab-full100-R2026a/family-b/comparison-native-evidence-adversarial-test`. B = `native-reader-baseline`; C = `native-reader-char-title` below.
- Actually viewed six original PNGs and twelve PDF/SVG previews, then focused original-PNG legend crops. No evaluator-wide repeat, canvas-PDF inspection, array/statistics recomputation, native-reader pass-count analysis, or MATLAB re-execution was performed.
- The visible-state setup in [test_comparison_native_evidence.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_comparison_native_evidence.m:79) sets `String=char(expectedTitle)`, face RGB `[0.1 0.4 0.7]`, edge RGB `[0.15 0.15 0.15]`, and face/edge alpha `0.65/0.35`. That source is setup context, not runtime proof; the artifact observations below stand separately. No test code was edited.
- Poppler 22.02.0 supplied `pdftoppm`, `pdftotext -bbox-layout`, `pdfinfo -box`, and `pdffonts`. Existing isolated `/tmp/svg-derived-pdf-round19-tqf6v5/tool/usr/bin/rsvg-convert` is librsvg 2.52.5. Previews reside only in `/tmp/native-char-title-round20-69pTrM`; original artifacts were not rewritten.
- PDF previews: `pdftoppm -png -singlefile -scale-to 1600`; SVG previews: `rsvg-convert --format=png --dpi-x=96 --dpi-y=96 --width=1600 --keep-aspect-ratio`. Each preview is 1600x1000. No custom SVG stylesheet was applied; a librsvg preview is not an independent browser check.
- All original PNGs are 2400x1500 at embedded 299.9994 DPI. All PDFs have one 576x360-point MediaBox/CropBox. All SVGs declare 2400px x 1500px, native `viewBox="0 0 576 360"`, and physical 8x5 inches. These size observations do not establish text fit.
- Each directory has `baseline-test-evidence.json`, scoped `synthetic_native_reader_test_only`, with `visual_verified=false` and `desktop_interaction_verified=false`. There is no `figures.json` or separately saved char-title manifest in these directories. This review therefore records file snapshots, not a fabricated manifest binding or borrowed unmeasured/bounds inventory. Input JSON files were hashed for preservation, not scientifically re-audited.

## Per-format observations

All cases retain both legend-title strings, statistics, the model-side-not-provided statement, and visible scatter. "Fits" below is a limited observation of the linked image, not an upgraded verification flag. C's second line shifts left and scatter paint changes in every row.

| Release/state | Original PNG | Original PDF and preview | Original SVG and preview |
| --- | --- | --- | --- |
| R2021a B | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2021a/family-b/comparison-native-evidence-adversarial-test/native-reader-baseline.png): xlabel masked; first legend-title line crosses frame. | [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2021a/family-b/comparison-native-evidence-adversarial-test/native-reader-baseline.pdf), [preview](/tmp/native-char-title-round20-69pTrM/R2021a-baseline-pdf.png): main title cropped; xlabel masked; both legend-title lines overflow; reference-key collision. | [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2021a/family-b/comparison-native-evidence-adversarial-test/native-reader-baseline.svg), [preview](/tmp/native-char-title-round20-69pTrM/R2021a-baseline-svg.png): main title fits; xlabel masking and first-line frame overflow remain. |
| R2021a C | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2021a/family-b/comparison-native-evidence-adversarial-test/native-reader-char-title.png): both rows retained; second row left-shifted; same xlabel/first-row defects; scatter lighter. | [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2021a/family-b/comparison-native-evidence-adversarial-test/native-reader-char-title.pdf), [preview](/tmp/native-char-title-round20-69pTrM/R2021a-char-title-pdf.png): second row now fits; other B defects remain; scatter lighter. | [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2021a/family-b/comparison-native-evidence-adversarial-test/native-reader-char-title.svg), [preview](/tmp/native-char-title-round20-69pTrM/R2021a-char-title-svg.png): second row complete and left-shifted; same xlabel/first-row defects; scatter lighter. |
| R2024b B | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2024b/family-b/comparison-native-evidence-adversarial-test/native-reader-baseline.png): title, axes and both legend rows fit. | [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2024b/family-b/comparison-native-evidence-adversarial-test/native-reader-baseline.pdf), [preview](/tmp/native-char-title-round20-69pTrM/R2024b-baseline-pdf.png): main title cropped; first legend-title row overflows; key collision; xlabel fits. | [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2024b/family-b/comparison-native-evidence-adversarial-test/native-reader-baseline.svg), [preview](/tmp/native-char-title-round20-69pTrM/R2024b-baseline-svg.png): title, axes and both legend rows fit. |
| R2024b C | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2024b/family-b/comparison-native-evidence-adversarial-test/native-reader-char-title.png): both legend rows fit; second row left-shifted; scatter lighter. | [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2024b/family-b/comparison-native-evidence-adversarial-test/native-reader-char-title.pdf), [preview](/tmp/native-char-title-round20-69pTrM/R2024b-char-title-pdf.png): same main-title crop, first-row overflow and key collision; second row complete; scatter lighter. | [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2024b/family-b/comparison-native-evidence-adversarial-test/native-reader-char-title.svg), [preview](/tmp/native-char-title-round20-69pTrM/R2024b-char-title-svg.png): both rows fit; second row left-shifted; scatter lighter. |
| R2026a B | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2026a/family-b/comparison-native-evidence-adversarial-test/native-reader-baseline.png): main title, xlabel and both legend rows fit. | [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2026a/family-b/comparison-native-evidence-adversarial-test/native-reader-baseline.pdf), [preview](/tmp/native-char-title-round20-69pTrM/R2026a-baseline-pdf.png): full title and legend rows; no corresponding old crop/overlap observed. | [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2026a/family-b/comparison-native-evidence-adversarial-test/native-reader-baseline.svg), [preview](/tmp/native-char-title-round20-69pTrM/R2026a-baseline-svg.png): title, xlabel and both legend rows fit. |
| R2026a C | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2026a/family-b/comparison-native-evidence-adversarial-test/native-reader-char-title.png): both rows retained and inside frame; second row left-shifted; lighter face/outline. | [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2026a/family-b/comparison-native-evidence-adversarial-test/native-reader-char-title.pdf), [preview](/tmp/native-char-title-round20-69pTrM/R2026a-char-title-pdf.png): both rows complete, second left-shifted; no new padding crop; scatter lighter. | [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2026a/family-b/comparison-native-evidence-adversarial-test/native-reader-char-title.svg), [preview](/tmp/native-char-title-round20-69pTrM/R2026a-char-title-svg.png): retained spaces and left shift; both rows fit; scatter lighter. |

## Title coordinates and crops

PDF coordinates are external text boxes in points from the page's top-left, not MATLAB native bounds. Both lines are fully extractable in every PDF, including those with visible frame overflow. Extraction alone does not establish unobscured display.

| Release | First legend-title row x / y, unchanged B to C | Second row B x -> C x; unchanged y | Approximate legend frame, 1600x1000 PDF preview |
| --- | --- | --- | --- |
| R2021a | 184.50..490.50 / 263.098..270.958 | 229.00..409.00 -> 197.50..377.50; 277.098..284.958 | x=533..1114, y=719..834; first row extends to x about 1363 |
| R2024b | 185.00..491.00 / 280.710..288.570 | 229.50..409.50 -> 198.00..378.00; 294.710..302.570 | x=503..1147, y=761..897; first row extends to x about 1364 |
| R2026a | 192.600..401.677 / 282.940..294.731 | 234.000..359.803 -> 204.840..330.643; 295.180..306.971 | x=506..1144, y=782..898; both rows remain inside |

- Older PDFs' main title boxes end at x=580.700 points on a 576-point page (y=43.073..53.291); extracted text ends `stable identiti`, rather than `stable identities`, in both states. R2026a's full title ends at x=472.872 (y=38.337..54.664), inside the page in both states.
- R2021a's xlabel box is y=254.089..262.735 points, while the legend background begins around y=259; its lower strokes are visibly masked in both states. The first-row overflow and xlabel masking predate the char padding and must not be attributed to a new padding crop.
- Unscaled original-PNG crops, top-left-origin `[left,top,right,bottom]`: R2021a `[700,1000,1800,1300]` ([B](/tmp/native-char-title-round20-69pTrM/R2021a-baseline-png-legend-detail.png), [C](/tmp/native-char-title-round20-69pTrM/R2021a-char-title-png-legend-detail.png)); R2024b `[700,1050,1800,1380]` ([B](/tmp/native-char-title-round20-69pTrM/R2024b-baseline-png-legend-detail.png), [C](/tmp/native-char-title-round20-69pTrM/R2024b-char-title-png-legend-detail.png)); R2026a `[700,1070,1800,1380]` ([B](/tmp/native-char-title-round20-69pTrM/R2026a-baseline-png-legend-detail.png), [C](/tmp/native-char-title-round20-69pTrM/R2026a-char-title-png-legend-detail.png)). Cropping is only for separate inspection derivatives; originals remain intact.

## Actual paint changes

- Baseline SVG marker fill is RGB `(0,114,178)` / `#0072b2` with opacity 1. C changes it to `(26,102,179)` / `#1a66b3`: older SVGs serialize fill opacity `0.651` and marker-edge stroke opacity `0.349`; R2026a uses `0.65098` and `0.34902`. The edge color is `(38,38,38)`. These are the actual serialized values, not an assertion of exact decimal alpha preservation.
- The isolated lower-left scatter marker is visibly present and lighter in each paired output. In the R2021a original PNG ROI `[999,870,1035,904]`, prominent baseline face RGB `(0,114,178)` becomes `(104,154,205)` in C; surrounding background `(249,251,252)` remains present. PDF/SVG previews similarly show face `(103,154,204)` in C. This supports a real paint change, not a numerical recovery of alpha from pixels. R2026a C's PNG outline is particularly pale; visibility does not guarantee strong contrast.
- Exact decoded RGB pixel differences below compare B versus C within each format, without resizing either input to that comparison. Whole-image counts include both the title shift and paint change; the separate plot ROI excludes the legend/title. These are diagnostic counts, not quality thresholds or scientific-array tests.

| Release | Format | Changed pixels, whole image | Changed pixels, plot ROI |
| --- | --- | ---: | ---: |
| R2021a | PNG | 14776 | 4501 |
| R2021a | PDF preview | 6828 | 2042 |
| R2021a | SVG preview | 7434 | 2111 |
| R2024b | PNG | 14834 | 4519 |
| R2024b | PDF preview | 6858 | 2100 |
| R2024b | SVG preview | 7485 | 2118 |
| R2026a | PNG | 14807 | 4503 |
| R2026a | PDF preview | 6959 | 2162 |
| R2026a | SVG preview | 6974 | 2176 |

Older-release plot ROIs are `[960,412,1515,975]` for native PNGs and `[640,275,1010,650]` for previews. R2026a ROIs are `[922,382,1560,1012]` and `[615,255,1040,675]`, respectively. Marker overlap and faint short uncertainty segments still prevent a visual certification of every identity/interval. No array equivalence or reader acceptance is inferred from these image comparisons.

## Fonts and evidence limits

All four older PDFs contain unembedded Courier (Type 1, WinAnsi; emb/sub/uni=no), while both R2026a PDFs contain WenQuanYiZenHei (CID TrueType, Identity-H; emb=yes, sub=no, uni=yes). No CJK glyphs are exercised. The old SVGs render outlined text and have no text nodes; R2026a retains native text nodes, including the padded second title row. These observations do not prove cross-viewer font portability or authorize upgrading any visual/embedding status. Exact PDF alpha operators were not independently audited; PDF evidence here is its actually viewed composited appearance. No geometry, trusted status, manifest, or production artifact is rewritten.

## Immutable originals

All 24 directory files retain the same **before and after** SHA-256 and byte counts. R2026a's baseline snapshot was taken when that package arrived, before its inspection; the first two releases were checked unchanged when extending the snapshot. `B/C` below denote the exact artifact stems linked above; `evidence` is `baseline-test-evidence.json`; `input` is `paired_observation_model.input.json`. No manifest hash-matching claim is made where no manifest exists.

| Release | File | Bytes | SHA-256, before = after |
| --- | --- | ---: | --- |
| R2021a | evidence | 4168 | `7bf3cce9a36e2eec47b74b790fcdfb5c2c5ad3569e7524aaf6f5547a73fcf67a` |
| R2021a | B PDF | 4109 | `50a07bbef09fcc83936f09a2c863a479b74dabb8ea896279f6c8c4d44c85569f` |
| R2021a | B PNG | 131640 | `be88f2dd78b895d80ec515dffd0f0422edc8633909f51f2d7bea43a50794fb7c` |
| R2021a | B SVG | 173673 | `8f046204125ebd3a4aaf085290ab97889e9e7a8ef8a7f58e1ec6fb732c726a5f` |
| R2021a | C PDF | 6282 | `fb6f19812d0af511ce5274b5146efdcf9510197bd54632dfd9cda95cf499433b` |
| R2021a | C PNG | 133168 | `2b8e839ad528e607576415e4951a3f529170285d3656282e8fcbd9c42db64fb8` |
| R2021a | C SVG | 174872 | `6b4a9344a95def113cb4bf97813b20be2c573579783ba804bd6a456705a34ed7` |
| R2021a | input | 2771 | `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b` |
| R2024b | evidence | 4168 | `0f002fb1cb62e3ca97d9a990b79acdf93d92e856c8f58a76d1d0d9a055673233` |
| R2024b | B PDF | 4061 | `3086836ce531e606d14ebb46a82b24c6178f83da38142fe21d1d2d1353b94336` |
| R2024b | B PNG | 137384 | `05546f71a83a5418d5920cf82738a5200d0d197d386da9c16e65ea591d2e2e3f` |
| R2024b | B SVG | 173662 | `92a6fc9212a9aa72ce343e6966c1a5d8cf58e52f64698a7b6c052a520a657c07` |
| R2024b | C PDF | 6234 | `ef54895670cdcd4ad19bf8c68eabc986c5b3950ea32bce981e137c0dc2792733` |
| R2024b | C PNG | 138838 | `fac5648796fbe7ade9242e5a1cfe1528b17c95d0b65d72c6efa7e7300de30436` |
| R2024b | C SVG | 174861 | `9110fe1564bc3fb0e67018235ee64ee74b6e4ac35b568eaab4de8728cfae1061` |
| R2024b | input | 2771 | `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b` |
| R2026a | evidence | 4168 | `79cb9d2b29a2e077173b7e043f33ec7091144d54968d44b7e9e5206ffeca346f` |
| R2026a | B PDF | 15421 | `3728ebc98e4030a28e4cbea5b123ce286628652f8088c333d717abc19a569994` |
| R2026a | B PNG | 164023 | `5ba1b113b5e083e78e06e4ab4be3ff76974b74c1c56e328f761dcdc61ca59a1c` |
| R2026a | B SVG | 32157 | `e562a32692a0d4f98d2aadf9cfa7acdc5a3cf792a52753e20983933d525d8828` |
| R2026a | C PDF | 16300 | `e5764be96c2a09043d47d3abaa2a9e4c913b9186c0ca1e02c0f31e9cda1f4e68` |
| R2026a | C PNG | 164944 | `0ee4f7b4096ba6774d08e09119949255ff9c579ee8374eea11cc78f8b72982d1` |
| R2026a | C SVG | 32433 | `2b76a912f7515e435cbb55c50578ea4873b6fa7143acdc604466bfc0448ac07c` |
| R2026a | input | 2771 | `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b` |

Only this report is added to the repository. All previews/crops are separate temporary derivatives; no code, original, gate, score, freeze, or trusted-human visual file is changed, and no commit is made.
