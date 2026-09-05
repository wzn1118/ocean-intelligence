# Text Bounds Review: CI 33992397354

Read-only review of `/tmp/matlab-run-33992397354`, with this report as the only new file.
Sources: each `matlab-full100-R2021a`, `matlab-full100-R2024b`, and `matlab-full100-R2026a` directory's `ci-stage-status.json` and `text-bounds/` originals.
All three `text-bounds` stages passed, with subsequent-case artifacts present; this is not a first-case-only result.
Each release has 19/20 stages passed. The remaining `export-runtime` failure is SVG-related, outside this review.

## Points Reference

Recomputed maximum absolute Extent / figure-bounds errors in pixels; WQ denotes WenQuanYi Zen Hei.

| Release | Screen DPI | Courier Extent / Bounds | WQ Extent / Bounds |
| --- | ---: | ---: | ---: |
| R2021a | 72 | 0 / 0 | 0 / 0 |
| R2024b | 72 | 0 / 0 | 0 / 0 |
| R2026a | 96 | 1.421085e-14 / 2.220446e-14 | 0 / 0 |

All six `nested-courier.json` / `nested-publication-original.json` cases have successful points probes, matching before/restored states, and errors below unchanged `1e-6` thresholds. Error arrays are four-element vectors, not broadcast matrices.
R2026a's original data-coordinate estimates still differ: maximum errors are 0.132841482 px (Courier) and 0.138450337 px (WQ). These retained diagnostics are not acceptance references.

## Completed Coverage

- Each release contains 12 diagnostic JSON files and 16 PNGs. All 16 native export records succeeded; local PNG headers match the recorded dimensions (48 PNGs checked overall).
- Original Courier/WQ, publication unfitted/fitted, and 90-degree rotation artifacts exist. Fitted title/xlabel/ylabel/axes-text public bounds are inside the figure; rotation dimensions satisfy the existing 3 px check. Added bottom margin is zero in all three runs.
- `colorbar-label.json` has genuine 3x2 `pixel_sizes`, with each row matching its named phase's measured Extent. Rows are `[15,95]` in R2021a/R2024b and approximately `[19.2,126.72]` in R2026a. Both colorbar PNG exports succeeded; final public bounds are inside and Rotation is 90.
- All four font-refresh artifacts exist: 9 to 22 pt increases width/height, the longer string increases width, and the final font is Courier with finite positive bounds.
- The original 80-W oversized-title negative case exported successfully in every release. Normalized `(left,right,width)` is approximately `(-1.180277,2.219028,3.399306)` in R2021a/R2024b and `(-1.073750,2.113750,3.187500)` in R2026a: both edges remain outside, width exceeds one.
- Final InvalidText/FigureMismatch checks have no standalone JSON; their completion is inferred from the passed stage and the test's uncaught sequential call order, not separately observed artifacts.

## Limits

This confirms the recorded public points/pixels conversion, parent offsets, and specified geometry tests, not general reliability of data-unit Extent or actual artifact clipping/readability.
The points cases measure the ASCII xlabel `Time (UTC)`; they do not establish CJK glyph quality, font embedding, or layout.Text bounds coverage. PNG header inspection is not visual QA. No local MATLAB rerun was performed.

## Original Integrity

Before/after SHA-256 checks match for all 28 text-bounds files plus `ci-stage-status.json` per release (87 originals total).
Aggregate hashes cover lexically sorted UTF-8 lines `relative_path<TAB>bytes<TAB>sha256<LF>`, relative to each release directory:
- R2021a: `3e1e57f2b2d437e200fc895ac03c149f073f710a3c9afb0709ec48f31aa3504a`
- R2024b: `a35d1b2f4d6520cd5c44f4e9ccc5473ac0167ef52fb17ab7b83f8cd33d15bb62`
- R2026a: `07a5a7c42fee483f86245b30b2df6db5783b2b86d52c6cb334db6305240e418d`
No original artifact, production file, test, scoring configuration, or freeze file was changed.
