# Round 18: Native Legend.Title Evidence Review

Reviewed 2026-09-05, CI 33996694221 (round-17 artifacts). Initial scope: R2021a and R2024b, four synthetic cases per release, not observed ocean data or the comparison-helper workflow. Source root: `/tmp/matlab-run-33996694221`; each release's cases are under `matlab-full100-<release>/text-bounds/legend-title/`. R2026a was absent at the first review; its subsequently downloaded originals are reviewed separately in the addendum below. The initial two-release findings and hashes are retained.

## Findings

- Both `text-bounds` stages actually passed: R2021a 22:46:07-22:46:16 UTC; R2024b 22:46:27-22:46:37 UTC. All eight case JSONs contain `assertions_completed=true`, native before/after records, and real PNG/PDF entries. This is not merely the first case or a static check. Both release summaries remain 18/20, not whole-CI success.
- Visible native Title identity, CJK inventory, and producer-to-writer evidence are consistent. Title geometry remains explicitly unverified. All eight PDFs still list unembedded Courier/Courier-Bold rather than the selected native WenQuanYi font; visible PDFs also show English Title overflow beyond the legend's right border. The coverage repair is not a PDF layout/font fix.

## Native State And Manifest

The following states are identical across the two releases. Title `FontSize` stays 13 before/after. Nonempty content is JSON-escaped `"\u5357\u6d77 Legend title"`; native class, content and visibility are preserved, not replaced with ordinary axes Text. FontName changes are explicit below.

| Case | Title / Legend Visible (before = after) | Title FontName before -> after | Unmeasured count | Bounds complete / layout stable | CJK present |
| --- | --- | --- | --- | --- | --- |
| visible | on / on | Courier -> WenQuanYi Zen Hei | 1 | false / false | true |
| empty | on / on; String empty | Courier -> Courier | 0 | true / true | false |
| hidden-title | off / on; String retained | Courier -> Courier | 0 | true / true | false |
| hidden-legend | on / off; String retained | Courier -> Courier | 0 | true / true | false |

- All eight native Title records have class `matlab.graphics.illustration.legend.Text`; their public-property inventories contain String/FontName/FontSize/Visible but not FontUnits/Extent/Position. Empty/hidden objects retaining Courier are excluded from visible unmeasured inventory, not reported as rendered CJK.
- Each visible entry has exactly six unmeasured fields: `role="legend.title"`, actual String, `font_name="WenQuanYi Zen Hei"`, `font_size=13`, the exact native class, and `geometry_status="unverified"`. No bounds or fabricated zero rectangle exists in that record. Its font appears in the selected-font inventory.
- Every case retains four measured text records: `legend-measured-probe`, axes title, xlabel, ylabel. All use WenQuanYi Zen Hei, FontSize 11, positive finite normalized bounds, and `clipped=false`. The native legend title does not leak into this measured list. `bounds_audited=true` means `bounds_audit_scope="measured_objects_only"`; recorded clipped/overlap counts are zero for that audited subset only.
- For both visible cases, decoded `visible-manifest.json.figures` equals the entire decoded diagnostic `entry`, not just selected fields: exports, hashes/bytes, identity/source, font and audit metadata all match. Manifest `artifact_validation` is passed/verified; `visual_inspection` remains `not_run`/false. Only visible cases have a writer manifest; no manifests are claimed for the other six cases.
- All eight entries keep `visual_inspection_verified=false`, `pdf_font_embedding_verified=false`, CJK `glyph_rendering_verified=false`, and all three publication typography verification flags false. `cjk_font_verified`/candidate verification is only installed-font selection evidence, not embedded-font or glyph proof. No evidence was refreshed or edited during this review.

## Independent Artifact Inspection

- All 16 PNG/PDF bytes and SHA-256 values match their case entries. All eight PNG IHDRs are 2400x1500; pHYs is 11811x11811 pixels/metre, unit 1 (299.9994 DPI). `pdfinfo -box` reports one 576x360-point page with matching MediaBox/CropBox for each PDF. Both formats record actual `print` APIs and 8x5-inch geometry, agreeing with runtime evidence; no SVG was requested.
- Viewed all eight original PNGs: visible cases show readable Chinese and English Title inside the legend; empty cases show only Series; hidden-title cases retain an empty title compartment and Series; hidden-legend cases show no legend. The retained blank compartment is not evidence that hidden text rendered. These observations cover only these synthetic images.
- Poppler 22.02.0 `pdffonts` on all eight PDFs lists Courier and Courier-Bold, Type 1 / WinAnsi, `emb=no`, `sub=no`, `uni=no`. `pdftotext -layout` extracts English Title only in visible cases; it extracts Series except for hidden-legend, and extracts no Chinese Title from either visible PDF. Extraction absence is not glyph absence.
- Viewed both visible PDFs through `pdftoppm -png -singlefile -scale-to 1400` streamed in memory: Chinese is visibly present, while `Legend title` crosses the right legend border but stays inside the page. PNG does not show that overflow. `pdftotext -bbox` places the English phrase at x=414..507.6 pt on both 576-pt pages. `pdftohtml -xml -stdout -i -zoom 1.0` reports its size 13, Courier family with bold text; native FontName selection therefore did not preserve the PDF font family. No PDF-internal encoding cause is asserted here.
- PDF font/text/page inspection covered eight files; PDF visual previews covered only the two visible cases. This is neither a trusted visual audit nor proof of all-figure clipping, glyph coverage, dataExtent reliability, or comparison-helper success. No scoring, gates, production/test code, or source artifacts changed; no local MATLAB rerun.

## Key SHA-256 Anchors

Case filenames below are relative to each release's `text-bounds/legend-title/`; `ci-stage-status.json` is at the release root. All 28 reviewed originals (26 legend-title files plus two stage records) retained identical bytes and hashes before/after inspection. Non-visible artifact hashes were also recomputed against their case JSONs.

| Release | File | SHA-256 |
| --- | --- | --- |
| R2021a | ci-stage-status.json | `1edff4dca55151e73c0c2a779dccf9af6e86c14e2f75b994b1ed6e48b4b550bf` |
| R2021a | visible.json | `5cfba41b9ba1ca5c139052a659f4398dec776bd47381fadbc34d4a189031dba0` |
| R2021a | empty.json | `00770411089a614b6029454a3cb14420673065af4dff87908d867b3872476642` |
| R2021a | hidden-title.json | `c12446a4bca08d633d87e40207773d7baa5e9cab8eb6e6c33239bc7c1a37749d` |
| R2021a | hidden-legend.json | `0ef9215fda0115766bcd1b9d70ece2712f4e059aba94a834639d006a9a211a90` |
| R2021a | visible-manifest.json | `a52f466df9a14545c367b8eb701f09c6edd1a89c55ff3a1b33cd40b6007d603c` |
| R2021a | legend-visible.png | `6fe397669483324093117c6af4e4179bdcb81daede6c31068c30e322f241a174` |
| R2021a | legend-visible.pdf | `d2089de9f482a686ee36a678a6f7036be73b8d150ad125a49f5d181cd4d8c650` |
| R2024b | ci-stage-status.json | `5d30e5c8d5582a87dbd23b233d4a2aa234b6a340f1e9054926fb7fd176090dce` |
| R2024b | visible.json | `17eea650ac97c4f84d71b4bbaa4c66b7fca814fb3af21166855fd887a4293384` |
| R2024b | empty.json | `5531a6234c884b3e1f436f90213380c3aff8ba5dea27ea1e1e6e8edb8e65c3af` |
| R2024b | hidden-title.json | `dd768becd3386161119a884a126ed4d0bb2fdb0f4a883446da1778050413b0a6` |
| R2024b | hidden-legend.json | `3e37db1c16d04eb56125b3479a9869ab933a24e77ac81363c7a684e8c23efd21` |
| R2024b | visible-manifest.json | `39ff4f9f52915efafbe6def7a48015b6c2aa84057458ec6ac300ce54068365a6` |
| R2024b | legend-visible.png | `acb704e3a94626a9d708bc63c1c19d31a04d51d4bc5fb71d2c3b568197814f15` |
| R2024b | legend-visible.pdf | `4e80df3fb4ffc7cc73e845ac13959ab4d4b68ee38af42f477ad9a3bc678034c1` |

## R2026a Addendum

The main thread supplied `/tmp/matlab-run-33996694221/matlab-full100-R2026a`; no independent download or MATLAB rerun was performed. Its `text-bounds` stage passed at 22:48:40-22:49:13 UTC, with all four case JSONs recording `assertions_completed=true`. The release summary is still 18/20, not overall CI success.

- All four native before/after Title records reproduce the state table above, including exact class, String, visibility, and `FontSize=13`. Only visible Title changes from Courier to WenQuanYi Zen Hei. Public properties still omit FontUnits/Extent/Position; visible inventory contains exactly the six existing `legend.title` fields, with `geometry_status="unverified"` and no bounds. Empty/hidden counts are zero; visible count is one and CJK presence is true only there.
- Four ordinary measured text records per case retain FontSize 11, WenQuanYi Zen Hei, finite positive normalized bounds and `clipped=false`. Audit scope remains `measured_objects_only`; visible `bounds_audit_complete` and layout `stable` remain false. All visual, glyph and PDF-font verification flags remain false, including publication typography. The complete decoded visible manifest entry equals the complete diagnostic entry, including original hashes/bytes, API and metadata; its visual status remains `not_run`/false.
- All eight R2026a PNG/PDF files match recorded bytes/SHA-256. PNG IHDR/pHYs independently confirm 2400x1500 and 299.9994 DPI; every PDF has one 576x360-point page and matching MediaBox/CropBox. Unlike the older releases, both APIs are `exportgraphics`, matching runtime, with inches sizing, exact exportgraphics available and no fallback reason. Runtime records R2026a Update 5, display present, JVM available, desktop unavailable and figure invisible; this is not a controlled same-renderer comparison with the older print jobs.
- `pdffonts` on all four PDFs lists `WenQuanYiZenHei`, CID TrueType / Identity-H, `emb=yes`, `sub=no`, `uni=yes`. Visible PDF extraction contains both Chinese characters and `Legend title`; empty/hidden-title PDFs omit Title text but retain Series, and hidden-legend omits both. This is fresh external evidence for these four PDFs, not permission to rewrite their unverified manifest flags or generalize to other outputs.
- Viewed all four original PNGs: visible Title is readable and inside its frame; empty shows Series only; hidden-title retains a blank title compartment; hidden-legend shows no legend. Viewed the visible PDF through a memory-only 1600x1000 Poppler preview: Chinese and English Title remain inside the legend frame, with no observed right-border overflow. The old R2021a/R2024b PDF overflow was **not reproduced in this R2026a visible fixture**; no layout repair is inferred from the role fix.
- `pdftotext -bbox` reports R2026a English Title x=422.279990..488.496679 pt, y=167.263920..183.590482 pt; Chinese x=442.439990..468.359989 pt, y=151.423920..167.750482 pt. These are external PDF text boxes, not native Legend.Title bounds, and were not inserted into any entry. The older English box is x=414..507.6 pt. `pdftohtml -zoom 1.0` reports R2026a Title fontspec size 12, while native state is 13; that tool output is retained as a diagnostic, not a claim that exported physical font size is independently certified or a diagnosed sizing regression.

### Layout Reproduction Targets

| Release | Visible PDF | Original PNG | Observed visible-PDF result |
| --- | --- | --- | --- |
| R2021a | [PDF](/tmp/matlab-run-33996694221/matlab-full100-R2021a/text-bounds/legend-title/legend-visible.pdf) | [PNG](/tmp/matlab-run-33996694221/matlab-full100-R2021a/text-bounds/legend-title/legend-visible.png) | English Title crosses right legend border, still inside page |
| R2024b | [PDF](/tmp/matlab-run-33996694221/matlab-full100-R2024b/text-bounds/legend-title/legend-visible.pdf) | [PNG](/tmp/matlab-run-33996694221/matlab-full100-R2024b/text-bounds/legend-title/legend-visible.png) | Same right-border overflow |
| R2026a | [PDF](/tmp/matlab-run-33996694221/matlab-full100-R2026a/text-bounds/legend-title/legend-visible.pdf) | [PNG](/tmp/matlab-run-33996694221/matlab-full100-R2026a/text-bounds/legend-title/legend-visible.png) | No Title overflow observed in this fixture |

PDF previews were streamed into the review conversation, not saved over originals or added as extra files. Reproduce the preview with `pdftoppm -png -singlefile -scale-to 1600 <absolute-PDF-path>` (PNG on stdout). Inspect the right-side legend around y=150..185 pt from the top. All twelve PNGs have now been viewed; font/text/page checks cover all twelve PDFs, but PDF visual previews cover only the three visible cases. Findings remain synthetic-fixture-specific, not trusted full-figure visual approval, dataExtent validation, or comparison-helper coverage.

### R2026a SHA-256 Anchors

| Release | File | SHA-256 |
| --- | --- | --- |
| R2026a | ci-stage-status.json | `8917eca329329f8a8769c171df2b2d68530c7470fdcea6a8475cfec5db7fd3e5` |
| R2026a | visible.json | `154d3e220abe7e4731ce53f62cc2a86c9fb7d8cbebc9ab4f6069552e13fb43eb` |
| R2026a | empty.json | `1710a20d7799f0fa8350136b0ea101c92ecec71278624e24fb7cf2b09adbe0d0` |
| R2026a | hidden-title.json | `f633d80215b6156c79dc4b9aa957f5c62f092a5925ddaacfb017196472cf9da7` |
| R2026a | hidden-legend.json | `be9c1c60d978d5c581dc05b723c9ca474afacb44ccef6d8a13f745355238c870` |
| R2026a | visible-manifest.json | `65841ac3b80196478363ddaf425fb0a725cae5169c89fb28ab902fd964f5e5dd` |
| R2026a | legend-visible.png | `2fc8095536614661854de7c3ad57e0f8262bd1b32a67743b54cadd35000a6456` |
| R2026a | legend-visible.pdf | `9a809f9c4b8048e166dc591d14fd75785edf8785afc803d6f44b0d0bd3180c38` |

All 42 reviewed source files (39 legend-title files plus three stage records) retained their bytes and hashes through the addendum audit. Only this report changed; no artifacts, gates, roles, production code or tests were modified, and no commit was made.
