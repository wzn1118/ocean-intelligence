# Round 22 Report Status Wiring Plan

## Decision

**The missing production call is confirmed. Do not wire the present MATLAB-only illustrated inspector unconditionally into every report.** The smallest honest design is an explicit, server-bound report profile plus mandatory evidence checks, with the existing content gates preserved. There is no runtime/profile selector or report-to-manifest registry in today's status interface; deciding that boundary is part of the implementation scope, not an existing capability.

This is a read-only follow-up to [round22 plan, section 2](/opt/ocean-intelligence/.codex-evals/matlab-100-20260905/astra-resume/ocean-report-e2e-plan-round22.md:40). Only this document was created. No user report, source, test, generated artifact, score, or freeze was changed; no server, model, HTTP request, deployment/reload, interruption, or commit was performed. The coordinator's isolated 8012 generation and production 8011 were not accessed.

## Current Call Chain

- [index.mjs:169](/opt/ocean-intelligence/codex-runtime/server/index.mjs:169) accepts `threadId/reportId`, verifies tenant ownership of the thread, validates report ID, and reconstructs HTML/Markdown paths. It does not verify a stored report-to-thread/runtime/manifest binding.
- [index.mjs:206](/opt/ocean-intelligence/codex-runtime/server/index.mjs:206) always calls `inspectReportQuality`. Plot quality is called only if tenant-root `figures.json` exists OR a depth-two scan finds any `.m`; if both are absent, `matlabPlotQuality=null` and no plot-evidence failure is appended.
- [index.mjs:222](/opt/ocean-intelligence/codex-runtime/server/index.mjs:222) discovers point HTML through a main-report text regex or report-prefixed filenames containing `interactive|temperature|point`. Zero matches gives an empty result array; `[].some(...)` appends no failure. `minimumInteractiveFigures=1` in the contract is unused here.
- [index.mjs:237](/opt/ocean-intelligence/codex-runtime/server/index.mjs:237) calls point inspection with only `{htmlPath}`. Its scientific-context and MATLAB-evidence requirements both default to false ([point checker:160](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:160)). Existing point markup/identity/interaction checks CAN already reject a discovered file; it would be inaccurate to say every DOM check is disconnected.
- `inspectIllustratedReportEvidence` is not imported or called by index. Production `complete` is only `missingPaths.length === 0` ([index:297](/opt/ocean-intelligence/codex-runtime/server/index.mjs:297)); the report-level claim/figure/manifest/scientific correspondence checker cannot currently add a failure.
- [turn creation:403](/opt/ocean-intelligence/codex-runtime/server/index.mjs:403) adds illustrated instructions to the model prompt but stores no report profile. Current thread instructions explicitly inject `runtime:'matlab'` ([index:759](/opt/ocean-intelligence/codex-runtime/server/index.mjs:759)). The [frontend API:189](/opt/ocean-intelligence/frontend/src/codexApi.ts:189) sends no runtime/profile in report creation or status. A runtime chosen elsewhere or written into an artifact is not an authoritative status-routing record.
- UI trusts `complete` and automatically requests one repair turn on failure ([surface:781](/opt/ocean-intelligence/frontend/src/components/CodexAgentSurface.tsx:781)); future integration tests should call an isolated handler/status endpoint, not this automatic model workflow.

## Inspector Contract

| Inspector | Actual options / scope | Wiring consequence |
| --- | --- | --- |
| `inspectIllustratedReportEvidence` | Only `htmlPath, markdownPath, manifestPath, outputDirectory, freshnessToleranceMs`; tolerance defaults to 2000 ms | Pass all paths explicitly from the server contract; no request-controlled tolerance or implicit cwd |
| Report-level checks | Nonempty reports, parsed claims/figures, figure/catalog/HTML unit and time correspondence, named-area metadata, export hashes/bytes, freshness, at least one declared HTML export | Add its result to completion for the matching strict profile even when files are missing |
| MATLAB requirements | Three-release `matlab_ci`; per-figure MATLAB runtime; main HTML `data-matlab-release`; HTML export calls point checker with BOTH strict flags true | Disabling only the matrix or passing an invented option cannot make this inspector Octave-compatible |
| `inspectPointInteractionQuality` | `htmlPath` or in-memory `html`; independent `requireScientificEvidence` and `requireMatlabEvidence` flags | Common scientific checks can be required without asserting MATLAB; this alone does not supply report/manifest correspondence |
| Existing plot checker | Source/theme checks, schema 2, paired PNG/PDF geometry/hash/bytes/freshness | Keep it; the illustrated checker is not a replacement for actual PNG/PDF validation |

References: [options:125](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:125), [artifact/point call:248](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:248), [matrix:334](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:334), [figure runtime:402](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:402), [HTML correspondence:443](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:443).

Additional integration boundaries, not silently repaired by a new call:
- The inspector visits ALL figures/exports in the supplied manifest; its interactive minimum is global to that manifest ([lines 182/194](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:182)). A tenant's unrelated figure can affect failures or supply the counted interactive export. Use a report-owned manifest/bundle or reject ambiguous ownership; do not create a filtered/rehashed replacement manifest to manufacture agreement.
- Every declared export is checked, but only PNG/PDF/HTML formats are accepted ([line 418](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:418)). A normal MATLAB PNG/PDF/SVG manifest is not automatically compatible. Optional SVG support or a separately specified report manifest needs an explicit decision, not dropping SVG evidence from an existing file.
- Report HTML/Markdown are read and freshness-checked; their bytes are not matched to declared report SHA-256 fields by this inspector. Export hash matching does not certify immutable report prose.
- The illustrated inspector computes `fileInfo` and can hash/read HTML before applying the final `pathOk` result; its containment helper is lexical, not realpath-based ([artifact reader:248](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:248)). Before exposing this reader through status, preflight report/manifest/export paths against the authorized bundle, including symlinks. An invalid path must block without reading outside the bundle. This is a source-based wiring risk, not an attempted cross-tenant read.
- Runtime and visual status fields are consumed as declarations. Wiring does not rerun MATLAB/Octave, authenticate CI receipts, prove upstream source truth, or authorize trusted visual status.

## Read-Only Reproduction

Used Node 22.14.0 and the existing frontend Babel parser to extract the exact status branch (index lines 169-307) and its seven local filesystem/path helpers into an in-memory async function. Public quality checkers and real read-only filesystem functions were retained, with call counters. Only tenant ownership and JSON response transport were stubbed; no HTTP server or browser service was imported/started. No test files or fixture directories were written.

| Extracted-handler input | Report / plot / point / illustrated calls | Result relevant to the gap |
| --- | --- | --- |
| Nonexistent `/tmp/report-status-wiring-round22-absent-3266102` | 1 / 0 / 0 / 0 | HTTP-shaped 200; plot=null; point=[]; no plot or point failure message |
| Existing repository `codex-runtime/octave/examples` as a read-only diagnostic root, 13 source .m files, no figures.json or matching report point HTML | 1 / 1 / 0 / 0 | Plot failure is appended because .m discovery triggers inspection; point absence still adds none |
| Ownership stub false | 0 / 0 / 0 / 0 | 404 before evidence filesystem checks |
| Invalid report ID | 0 / 0 / 0 / 0 | 400 before evidence filesystem checks |

Both first cases remain `complete=false` because report content/assets are absent (71/72 existing missing entries). **This proves conditional non-invocation, not that a real incomplete production report was observed returning complete=true.** The repository examples are not a tenant report, and no .m code was executed.

Direct public checker results on those nonexistent paths:
- Illustrated: `ok=false, manifestOk=false, artifactsOk=false, interactiveFigureCount=0`; reasons include `ocean_report.missing, matlab_ci.missing, manifest.missing`.
- Point: `pointInteractionQualityOk=false, htmlReadable=false`, `html-missing`.
- Supplying `runtime:'octave', requireMatlabEvidence:false, minimumInteractiveFigures:0` to the illustrated inspector produced a deep-equal result: these are unsupported/ignored options, not an opt-out API.

Existing point unit-fixture functions were also extracted without importing/running their test module:
| In-memory fixture | Scientific required | MATLAB required | Observed checker result |
| --- | --- | --- | --- |
| Existing basic `validHtml()` | false | false | true |
| Same basic HTML | true | false | false: 11 missing scientific-context fields |
| Existing `scientificHtml()`, declared MATLAB | true | true | true |
| Same scientific fixture, only declared authority changed to Octave | true | false | true |
| Same Octave-labelled fixture | true | true | false: `authoritative-runtime-not-matlab` |

These are synthetic unit inputs, including declared runtime flags; none proves a runtime executed or the browser actually displayed tooltips. They isolate checker-option behavior.

## Octave Boundary

Explicit Octave task routing exists ([routing contract:556](/opt/ocean-intelligence/codex-runtime/server/matlab-task-routing-contract.mjs:556)), and separate plotting instructions/templates exist. This is not an existing report-profile field at status.
The current [Octave writer:22](/opt/ocean-intelligence/codex-runtime/octave/oi_write_manifest.m:22) emits schema 1 with `generator="Ocean Intelligence Octave plotting"` and basic PNG metadata. It lacks this inspector's ocean_report/matlab_ci/scientific_context contract; even the current plot checker demands schema 2 ([quality:446](/opt/ocean-intelligence/codex-runtime/server/matlab-plot-quality.mjs:446)). Do not promise that preserving the old call makes every Octave bundle pass.
The Octave point builder's exported `normalizeData/createHtml` functions were invoked only in memory on two explicitly synthetic points. Current default point inspection already rejects that generated HTML with hover/focus-handler and unit-field findings. Enabling science adds missing context; enabling MATLAB adds runtime requirements. This is a compatibility finding, not a browser failure diagnosis; no parser/builder changes were attempted.
Rejecting Octave as MATLAB is correct for an explicitly MATLAB-authoritative contract. Applying that contract to an explicitly Octave-authoritative report is a routing error. Common DOM, source, time, unit, hash, and missing-evidence checks must not disappear on the Octave branch.

## Minimum Implementation To Confirm

1. **Bind policy before generation.** At report creation, bind tenant + threadId + reportId to a server-owned/versioned evidence profile and artifact/manifest scope; retries keep the same binding and reloads must not forget it. Today's contract has no such registry. Newly issued MATLAB-authoritative reports can retain the currently promised strict three-release contract. Explicit Octave and historical/unknown reports need a deliberate policy; do not infer a weaker profile from a missing manifest, .m suffix, artifact label, query flag, or changed HTML.
2. **Extract a side-effect-free status-evidence aggregator**, callable without importing index/startup. Keep authentication/ownership and report-ID checks before inspection, preserve current paths/counts/content/plot gates, and add `illustratedReportEvidence` plus stable diagnostic codes. For a bound MATLAB profile call the public inspector unconditionally with contract-derived paths. Missing, unreadable, invalid, or failed evidence must append a blocking reason so `complete` cannot remain true. Do not replace existing physical-artifact checks with its `ok`.
3. **Make required existence and scope explicit.** A required manifest missing with zero .m must fail. Required point HTML absent must fail independently of filename discovery. Use manifest-declared HTML for the report's own figures, not a report-prefix substring census or another report's HTML. Keep any existing discovery-based checks additive. For the first acceptance case use a fresh single-report isolated root; general shared-root report ownership still needs an implemented contract.
4. **Do not fake Octave support with ignored options or discarded failures.** Reuse point scientific checks with `requireScientificEvidence:true`, selecting the MATLAB flag from trusted policy. Full strict Octave report support additionally requires factoring common report/scientific/artifact validation away from ALL four MATLAB-dependent paths listed above, with a separately defined Octave evidence contract. If this is outside the approved change, return an explicit unsupported/unresolved profile state for that strict report instead of an erroneous MATLAB failure or a silent complete=true.
5. **Keep completion and validation levels honest.** Missing profile/bundle ownership must not silently select a legacy bypass. Preserve all numerical/content thresholds, hashes, geometry gates and original evidence. A small real replay can remain incomplete while exposing the new specific failures; no passed flags may be inserted to create a full-report positive.

Proposed bounded first package: `server/index.mjs` for report-policy binding and thin status wiring, plus a new callable `server/report-status-evidence.mjs` and its focused `.test.mjs`. The exact persisted binding location and migration policy must be confirmed before coding. Full Octave/common-inspector factoring additionally touches `illustrated-report-contract.mjs/.test.mjs` and the declared report profile; it is not a one-line index patch. Do not touch the concurrently owned point/parser or plotting-instructions files as part of this wiring package.

If only absence guards are authorized first, name that milestone accurately: it closes missing-manifest/missing-point skips but does NOT connect the report-wide DOM/unit/time inspector. Do not present that limited patch as completion of the full gap.

## Acceptance Boundaries

| Focused case | Required observation after implementation |
| --- | --- |
| Complete controlled baseline then remove manifest AND .m | Inspector still invoked; explicit manifest failure; complete false |
| Remove only required point HTML; or rename it outside discovery regex | Missing/declared HTML failure; no empty-array success |
| Claimed point data only in comments/inert DOM; invalid date; HTML/manifest/catalog unit mismatch | Existing public checker failure propagates through status, with the specific rule visible |
| Corrupt hash/bytes; stale/partially written manifest; malformed JSON | Fail closed; preserve artifacts; no manifest refresh or repair on a GET |
| Strict MATLAB declaration replaced with Octave, missing release, pending execution or visual flag | Strict failure remains; no runtime downgrade |
| Explicit Octave scientific positive versus same files under MATLAB profile | Common checks can pass without MATLAB assertions; strict MATLAB rejects; missing common evidence still fails |
| Unknown profile, profile switch on retry, altered client runtime, or server reload | No artifact-selected downgrade or forgotten required gate |
| Two reports in one tenant; other report has the only HTML export; foreign thread/report pair | No cross-report interactive count or manifest substitution; ownership failure precedes reads |
| Absolute/traversal export path or symlink escaping the bundle | Explicit path failure with zero out-of-bundle stat/hash/content reads |
| Optional SVG export present | Explicit supported/rejected behavior tested; never silently delete evidence |
| Unowned thread / invalid report ID | Preserve 404/400 and zero downstream checker calls |
| Inspector passes but content/geometry/count gate fails | complete stays false; no threshold relaxation |
| Real isolated replay already incomplete before mutation | Assert new rule/field failures, not merely unchanged complete=false |

Use existing synthetic library fixtures for controlled unit positives, clearly labelled as non-runtime evidence; test the aggregator's completion composition independently of the large prose thresholds without lowering those production constants. A real product-positive baseline requires actual accepted report/runtime evidence and is not established here. Later HTTP/tenant persistence and producer-to-status tests remain required; the in-memory branch probe is not that end-to-end test. Do not duplicate Aristotle's parser internals or invoke the UI's model repair loop.

## Read-Version Ledger

The following nine source files had identical SHA-256/bytes before and after the read-only probes. Other users' dirty changes were retained. These identify the audited working-tree versions, not deployment versions.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| [codex-runtime/server/index.mjs](/opt/ocean-intelligence/codex-runtime/server/index.mjs) | 67003 | `eb9a0e77c796306d39028700b757ef2bfc40fc1a2922f45ef5f85f6378f1901a` |
| [codex-runtime/server/illustrated-report-contract.mjs](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs) | 40176 | `c2d337ebb7fbe6cea9998be2698d39c6044ae40935176eacaa26ed061e5a23a1` |
| [codex-runtime/server/report-quality.mjs](/opt/ocean-intelligence/codex-runtime/server/report-quality.mjs) | 26284 | `19a1dd3cd718723f74e093361c5597ba7582750d3ec993239828273c7dd09b52` |
| [codex-runtime/server/matlab-plot-quality.mjs](/opt/ocean-intelligence/codex-runtime/server/matlab-plot-quality.mjs) | 36918 | `b6174da564d2b18b3a3ca02b65aa18bf2884eea09d66c117e072f2a5e6d5a066` |
| [codex-runtime/server/point-interaction-quality.mjs](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs) | 33341 | `1382c54f132b13609af4c7a849b5e31e8487a3f9f1f59ed99193576055173a1a` |
| [codex-runtime/server/ocean-report-html-parser.mjs](/opt/ocean-intelligence/codex-runtime/server/ocean-report-html-parser.mjs) | 4491 | `d8f68251e2e60e75586f64672b233828f1bd009167a98c4559181cc8bd6b1929` |
| [codex-runtime/octave/oi_write_manifest.m](/opt/ocean-intelligence/codex-runtime/octave/oi_write_manifest.m) | 2949 | `98d76ec0fcc0b72921d845272cb8a1bf1863382b06fdee188ea946d398e485aa` |
| [codex-runtime/octave/interactive/build-temperature-chart.js](/opt/ocean-intelligence/codex-runtime/octave/interactive/build-temperature-chart.js) | 19683 | `76d42e712dbd1a11da909e6886dc22f3a80dc595953c267673da638346cf4096` |
| [frontend/src/codexApi.ts](/opt/ocean-intelligence/frontend/src/codexApi.ts) | 9386 | `8d8af129653a926bd4d56f669e62de42a3a8432efada2ba1d1a941aedd0b0e08` |

Existing point fixture source SHA-256: `cb91d65249856e58bb7ab83dec5695dd8f5c52f0bd34aa047ef8b9e55ef04eea` ([test source](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.test.mjs:13)). In-memory Octave-builder HTML: 11383 bytes, SHA-256 `65d1576fee16aa91203679e98b7122333f2947df973c4cfedef7788a06b598c6`; it was never written to a report directory.
