# Native Vector Text Alignment Probe

## Scope

The new entry point is `codex-runtime/matlab/tests/test_vector_text_alignment.m`.
It does not call or change the production exporter, bounds helpers, manifest
writer, quality schema, scoring, fonts, or CI wiring. The main thread owns the
next CI invocation. No MATLAB execution is claimed by this design.

The supplied R2026a `33986526345/regression/run/profile.pdf` has an actual
576 x 360 pt page. Its long rotated ylabel is clipped while the supplied PNG
is reported normal. The SVG text anchor also warrants investigation. The
hypothesis that exact Width/Height causes temporary layout while vector text
retains placeholder Extent is **unverified**, not a conclusion of this probe.

## Four Controls

All controls use the same synthetic profile arrays copied from the regression
fixture, missing-value positions, WenQuanYi Zen Hei, an 8 x 5 inch figure, and
the same axes layout and font sizes. The long title includes English and
Chinese; the long English ylabel is rotated 90 degrees. Native label position
and alignment are not overwritten. Font installation uses exact family equality
against `listfonts` or `fc-list`, not `fc-match` substitution. Only installation
is checked; glyph
coverage, rendering, and embedding are not inferred from installation.

| Candidate | Figure History | PDF Call |
| --- | --- | --- |
| `01-exact-first` | New figure, initial drawnow and public-property snapshot | Exact native vector |
| `02-exact-second` | Same live figure as 01; property reads and file/JSON evidence only, no intervening render or layout setters | Exact native vector again |
| `03-png-measure-drawnow-exact` | Separate new figure; real exact PNG at 300 DPI, decode/hash, read public properties, drawnow, read properties again | Exact native vector |
| `04-native-tight` | Separate new figure with identical source and layout | Native axes vector without Width, Height, Units, Padding, or PreserveAspectRatio |

Exact calls use `Units="inches"`, `Width=8`, `Height=5`, `Padding="figure"`,
`PreserveAspectRatio="on"`, and `ContentType="vector"`. The tight control is
explicitly **not an exact-page export**. The desired exact page is 576 x 360 pt;
this is recorded as an expectation, never as measured PDF geometry.
The tight control targets axes, supported by the old releases, while exact
controls target the figure. The actual target class is recorded. The comparison
therefore varies the supported target as well as sizing options, not one isolated
parameter.

There are at most four PDFs and one PNG. No SVG export is inserted between
the shared-figure PDF calls: that would change their rendering history. The
PNG is a real native export, must decode to a nonuniform 2400 x 1500 raster,
and is not used to fabricate a PDF, text rectangle, or private coordinate.
Reading Extent may itself affect lazy internal state; these reads are explicit
in the recorded sequence and are not claimed to be observationally inert.

## Evidence And Status

`vector-text-alignment.json` stores the exact source arrays (NaN becomes JSON
null, with a separate missing mask), requested font, release, JVM probe,
screen DPI, callable `which('exportgraphics')` path, candidate options,
figure-instance IDs, predecessor status, and before/after snapshots.

Each snapshot records public figure/axes geometry and every native title,
xlabel, and ylabel's class, String, Units, Extent, Position,
HorizontalAlignment, VerticalAlignment, Rotation, and font properties.
Every property read carries its success flag, original value/class/size, and
error information. No Units conversion, replacement text, fitted positions,
or inferred bounds are used. Snapshots after attempts are retained even when
native export fails. Every existing nonempty artifact records bytes/SHA-256.

R2021a/R2024b skip the first three candidates with
`exact_options_require_R2025a`; they can run the tight control. Their report
is `completed_with_skips`, with `exact_comparison_completed=false`, not a
successful exact comparison. A normal callback return means collection of
the supported subset completed, not that all four candidates passed. A
missing callable API/font leaves explicit skips; zero exports or unexpected
export/property/hash failures raise an error after writing the report.

On newer releases four completed exports yield
`exports_completed_pending_external_review`, never a visual pass. Visual,
text-extraction, font-embedding, PDF-page-size, and causal-hypothesis claims
remain unverified. A second export following a failed first export is labeled
with that predecessor status and must not be treated as a clean success pair.

The output directory must be new. PDFs/PNG are never overwritten or removed;
only the diagnostic JSON is checkpointed as collection progresses. JSON uses
`jsonencode`, `unicode2native`, `fopen`, and `fwrite` without Java. SHA-256 uses
the existing utility, including its `sha256sum` fallback. A hash failure does
not prevent failure JSON from being written. No font fallback or print retry
is introduced.

## Invocation And External Review

The caller must choose a previously nonexistent output directory:

```matlab
addpath('codex-runtime/matlab/tests');
report = test_vector_text_alignment(fullfile(getenv('MATLAB_FULL100_OUTPUT'), ...
    'vector-text-alignment'));
```

Archive the JSON, all four available PDFs, and the PNG precondition together.
External review should first bind bytes/SHA-256, then run `pdfinfo -box`,
`pdffonts`, and `pdftotext -bbox-layout` independently on each PDF. Render
whole pages for `view_image`; never crop or edit the originals. Compare the
actual title/ylabel strings against the JSON, glyph readability and searchable
text separately, font embedding, page boxes, and text-to-page alignment.

Compare 01 versus 02 for repeated native export, 01 versus 03 for raster
pre-render plus measurement/drawnow, and 01 versus 04 for exact versus tight
export. A difference narrows the tested sequence; it does not establish which
MATLAB internal cache or coordinate transform caused the defect. A passing
font check, successful API call, nonzero Extent, or matching page box does not
prove uncropped vector text. This focused fixture is not full publication or
cross-format acceptance and does not resolve the separate layout.Text gap.
