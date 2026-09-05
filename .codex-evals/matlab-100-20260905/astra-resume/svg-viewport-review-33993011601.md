# Restricted SVG Viewport Normalization Audit

Date: 2026-09-05. This is a research and synthetic-test audit, not a visual approval or a claim that run 33993011601 was rendered in this review.

## Original Evidence Actually Checked

- Run 33992397354, R2026a: `export/full100-export-artifacts/raster-997-613/raster-sizing.svg`, native viewBox `0 0 240 148`, 12447 bytes, SHA-256 `989642b9d16a6c2971c663d1964c9a55c98ca23f302708cd428154848d8782d2`.
- Run 33990723561, R2021a and R2024b: the same relative 997x613 path, native viewBox `0 0 239 147`, each 26485 bytes, SHA-256 `8115fef8744815650579ece9ee803801c604abdaef6210b0cf3d19f9edfb20c2`.
- Run 33990723561, R2021a: `display-comparison/publication/raster-400-300/raster-sizing.svg`, native viewBox `0 0 267 200`, 23648 bytes, SHA-256 `30e58f46ef95037bb9d9c9a3172bd4833cd015192e81b05ce883fc82d321369a`.
- All paths are under `/tmp/matlab-run-<run-id>/matlab-full100-<release>/`. Original hashes were rechecked unchanged for this audit. Four artifacts represent three unique inputs; the two old-release 997x613 files are identical.

## Completed Copy-Only Experiment

- Standard ElementTree XML processing, installed librsvg 2.52.5 and Cairo 1.16.0, and Pillow comparison; no package installation or original edits.
- Each real artifact was compared before/after nesting at target pixels with renderer DPI 96 and 300, then at twice the target pixels with DPI 300: 12 comparisons, all with zero changed RGBA pixels and zero changed white-composited RGB pixels, maximum channel error zero.
- Baselines were nonblank; normalized graphic subtree fingerprints were unchanged. Re-serialization does not imply identical SVG bytes.
- Five synthetic controls exercised percentages, child clips, existing nested SVG, root font percentages, selectors, and an exploratory root clip. The selector case changed 360115 pixels at 997x613; the other controls were pixel-identical in this renderer. The root-clip result is not general evidence that root effects are safe.
- Detailed original paths, hashes, renders and comparison statistics remain in `/tmp/svg-viewport-equivalence-TSB5lT/results.json`; the script and mathematical derivation are beside it. No large temporary files were copied into the repository.

## Restricted Equivalence Argument

For original viewBox `(a,b,vw,vh)` and target `(W,H)`, set `s=min(W/vw,H/vh)`, `tx=(W-s*vw)/2-s*a`, `ty=(H-s*vh)/2-s*b`. The original centered-meet content CTM is `T(tx,ty) S(s)`.
An outer viewBox `0 0 W H` has identity mapping at that target viewport. A child SVG of width W and height H with the original viewBox/aspect has the original CTM. At proportional display scale k, both compositions are `T(k*tx,k*ty) S(k*s)`.
Retaining the inner native viewBox preserves descendant viewport-percentage bases, subject to unchanged styles and clipping. The first production profile conservatively rejects percentage geometry and existing nested SVG rather than generalizing the positive controls.
New inner `overflow=visible` adds no viewport clip. Original child clips, coordinates and text stay in the original subtree. No rectangle, padding, stretch, or reconstructed plot is added.
Original horizontal meet margins remain 1.472972972973 pixels per side for R26 997x613 and 0.176870748299 for old 997x613; the DISPLAY 400x300 case retains vertical margins of 0.187265917603 pixels per side.
DOM-dependent selectors, external resources, root coordinate-dependent effects, and arbitrary host viewport/CSS changes are outside this argument. Geometry equality alone is insufficient for them.

## Added MATLAB DOM Contracts

- `tests/test_svg_viewport_normalization.m`: nine positive synthetic cases, each annotated twice, and 28 rejection cases. No figures, font lookup, rendering, or external resources are executed.
- Positive coverage: the three native/target combinations, nonzero native origin `[10 20 240 148]` normalized to target 997x613, missing-native-viewBox derivation from native dimensions, matching ratios including nonzero origin and non-default aspect, font-family percent/unit-like characters, and matching-ratio stylesheet bypass.
- Assertions bind returned outer viewBox, both normalization markers, native inner viewBox/aspect, neutral inner viewport, full ordered graphic/clip/text subtree snapshots, root ID, title/description escaping and uniqueness, pixel attributes, and effective physical CSS/metadata.
- Idempotence means no additional wrapper, no revalidation of the accepted nested viewport, unchanged payload and effective metadata/dimensions. It does not demand identical XML bytes or deduplication of equivalent CSS declarations.
- Rejection coverage includes unknown nodes, style elements and stylesheet processing instructions, scripts, external href/xlink:href, root transform/clip/filter/mask in attributes and inline styles, nested SVG, non-family percentages, em/rem, unsupported native aspect modes, and complex/escaped CSS values.
- The 27 profile-rejection cases require exactly `oi_annotate_svg:UnsupportedNormalization`; one malformed `0 0 239 147junk` viewBox requires `oi_annotate_svg:InvalidViewBox`. Every rejection checks unchanged original file bytes/SHA-256. Accepted font-family punctuation is a parser boundary test, not installed-font evidence.
- `tests/full100_export_contracts.m` calls the new test before publication figure construction, so a later export failure cannot prevent these independent DOM checks from running.

## Verification And Limits

- `mh_lint --matlab 2021a` passed for both changed MATLAB test files; `git diff --check` passed. Local MATLAB is unavailable, so native DOM execution on R2021a/R2024b/R2026a is still required.
- This audit changes only the new test, its contract-suite call, and this report. The coordinator owns the production helper; no evaluator, shell, freeze, or original artifact was edited here.
- Neither the synthetic test result nor metadata/viewBox agreement certifies exact native SVG output, cross-renderer equality, CJK readability, font embedding, or publication visual quality. No newly downloaded run is included in the historical pixel-equivalence counts.

## Official Basis

- [W3C viewport transform](https://www.w3.org/TR/SVG2/coords.html#ComputingAViewportsTransform), [percentage units](https://www.w3.org/TR/SVG2/coords.html#Units), and [nested viewport clipping](https://www.w3.org/TR/SVG2/coords.html#EstablishingANewSVGViewport).
- [W3C root selector](https://www.w3.org/TR/selectors-4/#root-pseudo) and [child combinator](https://www.w3.org/TR/selectors-4/#child-combinators) explain the concrete selector rejection.
