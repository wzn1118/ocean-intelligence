# Round 21 Comparison Visual Review

## Findings

- **R2021a evaluator remains visibly defective in all three formats.** The legend covers the lower part of the x-axis label, and its first title line exceeds the legend frame. Explicit legend font setup has not resolved either problem.
- **R2021a/R2024b PDF defects persist, with a small additional legend regression.** The evaluator main title is clipped at the right page edge; both figures' first legend-title line extends beyond its frame. Larger legend entries still collide with the reference-line sample; the reference label now extends farther beyond the frame.
- **U-line visibility improves in all three releases and formats.** The long helper interval is distinctly darker than the grid. Short evaluator intervals are easier to see outside markers, but marker overlap and coincidence with the dashed reference still limit individual interval readability.
- **R2026a was independently checked after its package arrived.** Both figures retain complete main titles, statistics, axis labels/units, and two legend-title lines inside their frames in PNG, PDF, and local SVG renders, old and new. No counterpart of the legacy PDF title/frame defects was observed in these specific outputs; this is not a general visual pass.

## Scope And Method

Reviewed on 2026-09-06: old/R19 run `33999054663` versus new/R20 run `34000171748`, R2021a/R2024b/R2026a. Revision `31e74db5` is coordinator-supplied provenance, not an independently verified local commit.
E = `evaluator-runtime/paired-observation-model`; H = `family-b/comparison-uncertainty/synthetic-observation-uncertainty`. Only these synthetic figures are covered, not real ocean observations.
Actually viewed all 36 artifacts: 12 original PNGs and 24 PDF/SVG full-frame renders, plus focused crops. No MATLAB was run locally. No native-36-suite, canvas, scientific-array recomputation, scoring, or trusted-human/trusted-visual signoff.
PDF previews use Poppler 22.02.0 `pdftoppm -png -singlefile -scale-to 1600`; SVG previews use existing librsvg 2.52.5 `rsvg-convert --format=png --dpi-x=96 --dpi-y=96 --width=1600 --keep-aspect-ratio`, with no XML edits or injected stylesheet. Derived previews/crops are temporary files under `/tmp/comparison-visual-round21-uz5qqr`, not original evidence or browser-independent certification.
All original PNGs are 2400x1500; every PDF has one 576x360 pt page. All SVG roots retain `viewBox="0 0 576 360"`, `width="2400px"`, `height="1500px"`; manifests record 8x5 inches. Coordinates below are top-left based, with PDF previews 1600x1000 and crops using exclusive right/bottom edges.

## Per-Format Comparison

| Current figure | PNG versus old | PDF versus old | SVG versus old |
| --- | --- | --- | --- |
| R2021a E | U darker; xlabel still partly covered; first legend-title line still crosses both sides of frame | Same overlap, clipped main title, long legend title, and colliding entries; reference-label overflow increases | Same xlabel/title-frame defects as PNG; U darker |
| R2021a H | Both legend-title rows and axis units retained; U clearly darker; larger entries fit | Main title retained; first legend-title row still outside frame; reference label newly crosses right frame | Both rows and units retained; U darker; entries fit |
| R2024b E | Title, statistics, axes, units, and two-row legend retained; U darker | Main title still clipped; legend-title overflow persists; reference label newly crosses right frame | No observed xlabel masking or title/frame clipping; U darker |
| R2024b H | Labels/legend retained; U darker; three visible markers remain | Main title retained; legend-title overflow persists; reference label newly crosses right frame | Labels/legend retained; U darker; three visible markers remain |
| R2026a E | Labels/legend retained; entries larger but fit; short U segments more visible | Full main title and both legend-title rows retained; entries larger but fit | Same specific layout observations as PDF; short U segments more visible |
| R2026a H | Both intervals darker; three visible markers remain; labels/legend fit | Full title, statistics, axes/units, legend rows and entries retained | Same specific observations as PDF |

In every H image, the middle marker without a horizontal U segment remains visible, the long interval has visible clearance from both axes boundaries, and "Model uncertainty not provided" remains displayed. This is an appearance check, not a recount or validation of the scientific arrays. In E, do not infer that all 11 individual intervals can be distinguished from the crowded markers.

## Quantified Evidence

- **Actual U paint:** all nine H format-specific old/new pairs (three releases x three formats) change stroke-core RGB `190,209,217 -> 14,37,51` against unchanged sampled background `249,251,252`. Native PNG ROI is `[1500,608,1530,648]`; PDF/SVG-preview ROI is `[1000,405,1020,432]`, away from markers and grid crossings. Each darkest sampled row contains respectively 30/20 matching core pixels. These are local color measurements, not a whole-figure contrast/accessibility certification.
- R2021a/R2024b SVG horizontal U elements independently retain `stroke-width:0.8` and opacity 1 while changing to the darker RGB; grid paint is not mistaken for U. Image geometry is not pixel-identical: H PNG stroke rows move 630->628 in R21/R24 and 633->631 in R26; PDF-preview rows move 420->419 in all three; SVG-preview rows move 420->419 in R21/R24 and 421->420 in R26.
- **Legend font changes are real, not a layout cure:** `pdftohtml -xml -zoom 1` reports legacy PDF entry size 9->10, with legend-title size staying 10. R26 reports integer entry size 8->9; its original SVG entry `font-size` changes 12->13 in native text coordinates, with legend-title size staying 13. Tool integer sizes/native SVG units are not asserted to be exact MATLAB point sizes. Manifest title/subtitle/xlabel/ylabel sizes remain 13/10/11/11, and the unmeasured legend title stays 10.
- **R21 xlabel remains occluded:** original-PNG crop `[700,1000,1800,1300]`: [old](/tmp/comparison-visual-round21-uz5qqr/old-R2021a-evaluator-xlabel-legend-crop.png), [new](/tmp/comparison-visual-round21-uz5qqr/new-R2021a-evaluator-xlabel-legend-crop.png). In PDF previews, the legend's top stroke moves y=718..720 -> 715..717; external xlabel bbox moves y=254.089..262.735 pt -> 253.081..261.727 pt. Its bottom still extends about 12 preview pixels into the legend area. Both rows move upward together; the obstruction is not removed.
- **Legacy main-title page clipping is unchanged:** all four old/new R21/R24 E PDFs extract an ending of `stable identiti`, not the complete `stable identities`; surviving title bbox reaches x=580.700 pt on a 576 pt page, around y=43.073..53.291 pt. Actual previews show the right-edge clipping, independently of manifest text. H titles do not show this page-edge defect.
- **Legacy PDF legend overflow:** external first-row text right edges versus scanned frame-right pixels are R21 E 1362.5 vs 1114, R24 E 1363.9 vs 1147, R21 H 1352.8 vs 1136, R24 H 1347.2 vs 1131. These horizontal extents are unchanged old->new. The title remains visible outside the legend rather than being wholly lost from the page.
- New PDF reference-label right edges are approximately 1142.9/1155.6/1144.4/1138.9 px for R21 E/R24 E/R21 H/R24 H, exceeding those frames by 29/9/8/8 px. Old right edges were 1120.0/1132.5/1121.4/1115.8 px: R21 E already overflowed slightly; the other three were inside. Crops: R21 E PDF `[490,690,1390,850]` [old](/tmp/comparison-visual-round21-uz5qqr/old-R2021a-evaluator-pdf-legend-crop.png), [new](/tmp/comparison-visual-round21-uz5qqr/new-R2021a-evaluator-pdf-legend-crop.png); R24 H PDF `[465,810,1385,985]` [old](/tmp/comparison-visual-round21-uz5qqr/old-R2024b-helper-pdf-legend-crop.png), [new](/tmp/comparison-visual-round21-uz5qqr/new-R2024b-helper-pdf-legend-crop.png).
- **R26 is different in the actual PDFs:** new E main-title xMax=472.512 pt, inside the page; E/H first legend-row xMax=401.677/395.557 pt, approximately 28/29 preview pixels inside frame-right x=1144/1128. Both already fit in old R26. Helper PDF legend crop `[465,810,1385,985]`: [old](/tmp/comparison-visual-round21-uz5qqr/old-R2026a-helper-pdf-legend-crop.png), [new](/tmp/comparison-visual-round21-uz5qqr/new-R2026a-helper-pdf-legend-crop.png). U/endpoint crop from SVG preview `[520,385,1120,465]`: [old](/tmp/comparison-visual-round21-uz5qqr/old-R2026a-helper-svg-u-crop.png), [new](/tmp/comparison-visual-round21-uz5qqr/new-R2026a-helper-svg-u-crop.png).
- **Actual PDF fonts:** all eight old/new legacy PDFs list only Courier, Type 1, unembedded, with no Unicode map. All four R26 PDFs list WenQuanYiZenHei, CID TrueType, embedded, Unicode map present. Manifest font selection remains WenQuanYi Zen Hei in all versions; it does not prove the legacy PDF used that font. These English-only fixtures cannot certify CJK glyph coverage.

## Manifest Limits And Preservation

All 36 artifact SHA-256/byte values match their own original manifest export entries. R21/R24 record `print` for all three formats; R26 records `exportgraphics`.
All 12 relevant entries retain one `unmeasured_text_objects` object: role `legend.title`, class `matlab.graphics.illustration.legend.Text`, both title strings joined in the inventory, WenQuanYi Zen Hei/10, `geometry_status="unverified"`, and no fabricated bounds.
All retain `bounds_audited=true`, `bounds_audit_scope="measured_objects_only"`, `bounds_audit_complete=false`, `unmeasured_count=1`, `visual_inspection_verified=false`, and `publication.layout.stable=false`; top-level visual status remains `not_run`/false. Zero measured clipping/overlap counts are not claims about the exported legend or PDF page. PDF-embedding flags remain false, even where this external inspection sees R26 embedding; nothing was refreshed or promoted.
SHA-256 and byte length were recorded before inspection and reread after rendering/analysis: all 48 originals (36 artifacts + 12 manifests) are unchanged. Full before=after values are retained below.
Coordinator-reported R21 `comparison-statistics-layout` Subtitle perturbation failure and the proposed `oi_apply_axes` fix are outside this artifact comparison; no future/current-working-tree change is credited to these immutable files. No original, code, test, gate, score, or freeze file was edited, and no commit was made.

## Original And Preview Index

`old` means run 33999054663; `new` means run 34000171748. E/H are defined above. Every linked full-frame original/render was viewed.

| Run / release / figure | Original files | Full-frame derived previews |
| --- | --- | --- |
| old R2021a E | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2021a/evaluator-runtime/paired-observation-model.png) [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2021a/evaluator-runtime/paired-observation-model.pdf) [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2021a/evaluator-runtime/paired-observation-model.svg) [manifest](/tmp/matlab-run-33999054663/matlab-full100-R2021a/evaluator-runtime/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/old-R2021a-evaluator-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/old-R2021a-evaluator-svg.png) |
| old R2021a H | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2021a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.png) [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2021a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.pdf) [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2021a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.svg) [manifest](/tmp/matlab-run-33999054663/matlab-full100-R2021a/family-b/comparison-uncertainty/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/old-R2021a-helper-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/old-R2021a-helper-svg.png) |
| old R2024b E | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.png) [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.pdf) [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.svg) [manifest](/tmp/matlab-run-33999054663/matlab-full100-R2024b/evaluator-runtime/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/old-R2024b-evaluator-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/old-R2024b-evaluator-svg.png) |
| old R2024b H | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2024b/family-b/comparison-uncertainty/synthetic-observation-uncertainty.png) [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2024b/family-b/comparison-uncertainty/synthetic-observation-uncertainty.pdf) [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2024b/family-b/comparison-uncertainty/synthetic-observation-uncertainty.svg) [manifest](/tmp/matlab-run-33999054663/matlab-full100-R2024b/family-b/comparison-uncertainty/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/old-R2024b-helper-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/old-R2024b-helper-svg.png) |
| old R2026a E | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.png) [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.pdf) [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.svg) [manifest](/tmp/matlab-run-33999054663/matlab-full100-R2026a/evaluator-runtime/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/old-R2026a-evaluator-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/old-R2026a-evaluator-svg.png) |
| old R2026a H | [PNG](/tmp/matlab-run-33999054663/matlab-full100-R2026a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.png) [PDF](/tmp/matlab-run-33999054663/matlab-full100-R2026a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.pdf) [SVG](/tmp/matlab-run-33999054663/matlab-full100-R2026a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.svg) [manifest](/tmp/matlab-run-33999054663/matlab-full100-R2026a/family-b/comparison-uncertainty/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/old-R2026a-helper-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/old-R2026a-helper-svg.png) |
| new R2021a E | [PNG](/tmp/matlab-run-34000171748/matlab-full100-R2021a/evaluator-runtime/paired-observation-model.png) [PDF](/tmp/matlab-run-34000171748/matlab-full100-R2021a/evaluator-runtime/paired-observation-model.pdf) [SVG](/tmp/matlab-run-34000171748/matlab-full100-R2021a/evaluator-runtime/paired-observation-model.svg) [manifest](/tmp/matlab-run-34000171748/matlab-full100-R2021a/evaluator-runtime/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/new-R2021a-evaluator-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/new-R2021a-evaluator-svg.png) |
| new R2021a H | [PNG](/tmp/matlab-run-34000171748/matlab-full100-R2021a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.png) [PDF](/tmp/matlab-run-34000171748/matlab-full100-R2021a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.pdf) [SVG](/tmp/matlab-run-34000171748/matlab-full100-R2021a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.svg) [manifest](/tmp/matlab-run-34000171748/matlab-full100-R2021a/family-b/comparison-uncertainty/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/new-R2021a-helper-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/new-R2021a-helper-svg.png) |
| new R2024b E | [PNG](/tmp/matlab-run-34000171748/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.png) [PDF](/tmp/matlab-run-34000171748/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.pdf) [SVG](/tmp/matlab-run-34000171748/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.svg) [manifest](/tmp/matlab-run-34000171748/matlab-full100-R2024b/evaluator-runtime/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/new-R2024b-evaluator-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/new-R2024b-evaluator-svg.png) |
| new R2024b H | [PNG](/tmp/matlab-run-34000171748/matlab-full100-R2024b/family-b/comparison-uncertainty/synthetic-observation-uncertainty.png) [PDF](/tmp/matlab-run-34000171748/matlab-full100-R2024b/family-b/comparison-uncertainty/synthetic-observation-uncertainty.pdf) [SVG](/tmp/matlab-run-34000171748/matlab-full100-R2024b/family-b/comparison-uncertainty/synthetic-observation-uncertainty.svg) [manifest](/tmp/matlab-run-34000171748/matlab-full100-R2024b/family-b/comparison-uncertainty/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/new-R2024b-helper-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/new-R2024b-helper-svg.png) |
| new R2026a E | [PNG](/tmp/matlab-run-34000171748/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.png) [PDF](/tmp/matlab-run-34000171748/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.pdf) [SVG](/tmp/matlab-run-34000171748/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.svg) [manifest](/tmp/matlab-run-34000171748/matlab-full100-R2026a/evaluator-runtime/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/new-R2026a-evaluator-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/new-R2026a-evaluator-svg.png) |
| new R2026a H | [PNG](/tmp/matlab-run-34000171748/matlab-full100-R2026a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.png) [PDF](/tmp/matlab-run-34000171748/matlab-full100-R2026a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.pdf) [SVG](/tmp/matlab-run-34000171748/matlab-full100-R2026a/family-b/comparison-uncertainty/synthetic-observation-uncertainty.svg) [manifest](/tmp/matlab-run-34000171748/matlab-full100-R2026a/family-b/comparison-uncertainty/figures.json) | [PDF](/tmp/comparison-visual-round21-uz5qqr/new-R2026a-helper-pdf.png) [SVG](/tmp/comparison-visual-round21-uz5qqr/new-R2026a-helper-svg.png) |

## Original Hash Ledger

One value per original; before and after are equal for both bytes and SHA-256. The index resolves every key to its exact file; `manifest` is the same folder's `figures.json`.

| Run / release / figure | File kind | Bytes before=after | SHA-256 before=after |
| --- | --- | ---: | --- |
| old R2021a E | manifest | 70118 | `298870a85f2444b575a9dacdbb54af661b93208a526a065fc01b80a26835b1b6` |
| old R2021a E | pdf | 4109 | `907961edfb3f0e3c7618521c6d23c1c13f03fbc2df4b384781493509e8fe0a40` |
| old R2021a E | png | 131640 | `f83b24dd355abfba4271d1214b4d26d03b02246069a885e2f1552a871c2b273c` |
| old R2021a E | svg | 173673 | `8f046204125ebd3a4aaf085290ab97889e9e7a8ef8a7f58e1ec6fb732c726a5f` |
| old R2021a H | manifest | 17598 | `2643f53b8e022b4b03f5368c27213e828ecdf2d6b8e80045a2f04d1b243ecc11` |
| old R2021a H | pdf | 3415 | `2adfe12fa1851e9e67db550031e8ff61c1ee9e25e5175842ee38df9ac948b01f` |
| old R2021a H | png | 126293 | `161c63bbbc0a1cc508d6f14831e9e0476868e0a871d9736bda3573e6a0b0b4e3` |
| old R2021a H | svg | 145161 | `a88d70bdc36eec85247f5f58d7c4efc2fe9b40b29867ad4010e0bd6efe1df943` |
| old R2024b E | manifest | 70119 | `d0d195301004fa24c0891ee4e0e02f5d40e6919d425aa9d4fcbd91e76e1f5412` |
| old R2024b E | pdf | 4061 | `9063a342b50b1043b11312dbfb3e8d2a82d7231936b50a8310b9b9a854e093be` |
| old R2024b E | png | 137384 | `3ba09ae4246f472bc03efd866d99cfe9cae3f8c525b89f050d1be31bbbe6dc7b` |
| old R2024b E | svg | 173662 | `92a6fc9212a9aa72ce343e6966c1a5d8cf58e52f64698a7b6c052a520a657c07` |
| old R2024b H | manifest | 17594 | `43e03f668e165e5f017f159995841133a4debf19b6c42980c9008c679dc2f424` |
| old R2024b H | pdf | 3415 | `857e559e748cede15ef42f228d5df59b8d44d892dcda4fae0e9d3894e37e8e3a` |
| old R2024b H | png | 128322 | `9939e111bd472489b9b727ab7b36f93e2570251e8f4f00d7fddcf0592b0e410e` |
| old R2024b H | svg | 145161 | `8e1b2eb3e8d1f8416c2c2bf0b76534737ca35ab3bfca29468cda9dad10dfee13` |
| old R2026a E | manifest | 70092 | `0c519318b2e7aaf091ecc5beda8b89a01fcf37216f90ab6236c45df7671b2b27` |
| old R2026a E | pdf | 15421 | `fa5f13675385d3bccf2bec5f1a03b5d6f498d9e115dc28fccc0948c6ec23f9bd` |
| old R2026a E | png | 164023 | `6116da574df491b7b41451d6e39bc5e2d4807ecaf8e9542a3a3f2c94aeadc732` |
| old R2026a E | svg | 32157 | `e562a32692a0d4f98d2aadf9cfa7acdc5a3cf792a52753e20983933d525d8828` |
| old R2026a H | manifest | 17630 | `4eeb884d879477ba8bf37d9c1114d455d6dc7513961ff8c0f475a9f330171b30` |
| old R2026a H | pdf | 13443 | `a17c92828070b17f96b53e15197a8577eb6ea5cc0a6294e98464626a9351442d` |
| old R2026a H | png | 153666 | `d09a1a65c517da1350dd7104eaa09fd5fc7e9f92c460ee73c6238a85c86f97b6` |
| old R2026a H | svg | 28317 | `7c2d4d59aede44402b368dc63ba44c8b8c30148098c9502efa1cc9227f242da5` |
| new R2021a E | manifest | 70113 | `0cb074c3f0e9aed25232817df2aa95cc2936d54187f25997f9606dd76df2fb40` |
| new R2021a E | pdf | 4069 | `11ef545c1d445ffcad44b4bd614d44694cd21bb710bf0dcc412c4578124f4f17` |
| new R2021a E | png | 133047 | `ce4638c749c1f55aa72701faca5a63a6b222b3259eea7ccfb5cff9375ca0dfae` |
| new R2021a E | svg | 173857 | `7180bb89ccde9e5a48ebc4c31b1df3a729bfbb52fb8a02766926eccb9ca76bc1` |
| new R2021a H | manifest | 17597 | `601544cf265062741189f24393976bcaa4338643c83726349e3d6199f6a56b99` |
| new R2021a H | pdf | 3436 | `c754e3c14177daec93fc240810b720d3f14c7690acbe2eea14e7d2a6950849d9` |
| new R2021a H | png | 129072 | `1e95c24e5e9d33609a54d69ff2c9a18fc7248960915d57c5c6107f0ebb593453` |
| new R2021a H | svg | 145437 | `7a8450cd9bb33dd3c157da158b07f997264c703a6af673a91dde3d165a4c6548` |
| new R2024b E | manifest | 70123 | `d57f681062d25b7a5b2ca2cf4ab18d5fb55b161664deb5ce13950730ffa6ecfe` |
| new R2024b E | pdf | 4052 | `1ebdbec42e188c20f4d1fa5ed67324c9fcdc98d34f75fd9b97231a35dcdac695` |
| new R2024b E | png | 137613 | `8dc37d96c6356d086e5c15d196f8bee510e769ee0bb3ce6b092cc46ec64f2f53` |
| new R2024b E | svg | 173815 | `dacb6d0a769b672b2c4ec224a7eeef7e107800af878a44f830826303885ce76b` |
| new R2024b H | manifest | 17591 | `15eb0d223d2997171fb6588c4bde8517db8a14f3c765666da34f69fd7c4fedec` |
| new R2024b H | pdf | 3438 | `47ece98af97a04b9f4b6625cd2cac5d0a0218a9fb7e6c906f1e173a51e701fca` |
| new R2024b H | png | 128195 | `6fb1a04bb7b50fa65fb6b20e0ec3a35d7ff39ecb7a6e2b3006d06dbed9655c7c` |
| new R2024b H | svg | 145437 | `beaf1640cd679766a08ca4767be50da7b052883c03b3e8b42cb96ca58e8d3920` |
| new R2026a E | manifest | 70092 | `6ad3fd09c61de1c4c2b45d4ce37e709cc7922d355531e528884e28fc13ec2ddf` |
| new R2026a E | pdf | 15354 | `942eb170059f6d2ddf50adfb63e8539904bc12a189b64b3dbb0c815d9e215367` |
| new R2026a E | png | 164908 | `a405d88482b56ed7dc0a86e3fc930245ae0acb9d865b10f2da9e6bd52861c148` |
| new R2026a E | svg | 32168 | `967e5661e292463ba59adb43caf0c1842e2c02b1d0e9cdfd570b320521283451` |
| new R2026a H | manifest | 17633 | `c4912a498a9281059b8ea2d9e8ac2e3c5a4b6571300dc9fd7f147959bc707b95` |
| new R2026a H | pdf | 13371 | `8a3c8c9abe5d105bd3038887e6cadf074f2ac53b6a1dd66efe3e74da58604c3c` |
| new R2026a H | png | 154047 | `9f307e5d015d8591f22c73887c914fb977a99958fd58b627273031a546040748` |
| new R2026a H | svg | 28211 | `e4309487ab7da3384921f37113e65a1ba9cddc6fbdf4decd54cd9cbaaab8a282` |
