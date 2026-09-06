# Round 23: first Astra native trial, all three releases

Reviewed run `34002693563`, commit `0f6779785896bf3b2a7257ac72287d83cffec8ff`, on 2026-09-06 UTC. Originals: `/tmp/matlab-run-34002693563/matlab-full100-{R2021a,R2024b,R2026a}`. This is an artifact/log review, not a local MATLAB rerun, model repair, or visual approval.

## Actual outcomes

| Release | Job | Primary stages | Actual Astra trial |
| --- | --- | --- | --- |
| R2021a | 101404372442 | 19/20 | Construction failed: `astra_comparison_trial:FontUnavailable` |
| R2024b | 101404372411 | 19/20 | Construction failed: `astra_comparison_trial:FontUnavailable` |
| R2026a | 101404372479 | 20/20 | Same original source completed native v3 checks and PNG/PDF/SVG exports |

The primary-stage tally is 58/60, not an overall CI/visual/Desktop approval. R2026a is no longer pending and must not be reported as the same construction failure as the older releases.

## Old-release failure boundary

- Both `family-b/astra-comparison-trial/astra-generated-comparison-evidence.json` files record `phase=construction`, `matlab_call_completed=false`, `execution_verified=false`, and native proof/export/manifest `not_run`.
- The original source fails at line 118: `assert(any(strcmpi(string(listfonts), string(theme.FontName))), ...)`, with message `The selected font must be enumerated by listfonts.` The stack reaches driver line 106 and family-b line 108.
- The source has created the figure and selected 10 x 8.5 inches, but axes creation at line 120 and `oi_plot_comparison` at line 135 have not run. Its catch deletes the partial figure and rethrows. This does not establish that all numeric processing failed or that a font is absent.
- Each old-release Astra directory contains only the failure JSON: no trial PNG/PDF/SVG, manifest, or native v3 proof. Requested 3000 x 2550 at 300 DPI is a target, not observed output. Evaluator or adversarial-suite figures cannot fill this gap.
- The driver's final original-file/hash assertion was not reached on these failures. The independent before/after file inventory below is separate evidence, not a fabricated driver completion.

## Independent native/profile suites

All three `family-b/comparison-native-evidence-adversarial-test/native-reader-test-results.json` files contain the four existing positive cases, all 36 original negative cases, and the separate two-positive/eight-negative text-profile regression. Every ordered negative case and error identifier matches its actual job-log record; the three releases agree.

- The NaN case reaches the reader: `scatter-nan-size:run_matlab_gate:ComparisonProofHandles`, at raw log lines 1046 / 1077 / 1039 for R21 / R24 / R26. This is not the old MATLAB setter failure.
- Profile positives are `explicit-fixture-default` and `astra-labels-identical-v3`. Wrong fixture/Astra label combinations and wrong x/y units yield `ComparisonProofNativeText`; unknown, empty, array, and numeric profiles yield `ComparisonProofTextProfile` (all identifiers prefixed `run_matlab_gate:`).
- Exact terminal markers are `COMPARISON_NATIVE_READER_TEST_NEGATIVES=36`, `COMPARISON_TEXT_PROFILE_NEGATIVES=8`, `COMPARISON_TEXT_PROFILES=passed_synthetic_native_only`, and `COMPARISON_NATIVE_READER_TEST=passed_synthetic_native_mutations_only`.
- These four markers occur at R21 lines 1128-1131, R24 1157-1160, R26 1119-1122. The subsequent Astra failure markers are R21 line 1133 and R24 line 1162. R26 instead emits `ASTRA_COMPARISON_TRIAL_PROFILE=astra-temperature-labels` and `ASTRA_COMPARISON_TRIAL=passed_synthetic_native_v3_and_exports_only` at lines 1124-1125.
- Bound test source calls the profile regression at line 253, checks restored baseline equality at 254 and fixture/artifact hashes at 255-258, writes completion JSON at 270, then prints the terminal markers. Thus these assertions were reached; there is no invented standalone restoration marker. Each JSON records `original_artifacts_unchanged=true`; all six referenced suite artifacts per release and the fixture hash were independently checked.
- Complete logs contain no prior deleted-handle/onCleanup/restore_properties or `PositiveOrNanVectorDataPredicate` failure signatures. This is not a claim of globally warning-free logs; flat-alpha warnings remain outside that cleanup finding.

## Source and provenance binding

All 15 recorded `execution_files` entries in each trial evidence file match independently read local canonical bytes and SHA-256. This includes the unchanged original generated source, report, prompt, provenance, input, driver, reader, and listed helper dependencies.

| Bound file | Bytes | SHA-256 |
| --- | ---: | --- |
| Original `astra_comparison_trial.m` | 9303 | `508a8c8430c6d0d28797df1bc4256c1eca24eafe7fb816c8b77f686aa121e665` |
| Original generated `.md` | 8241 | `656c2d4025b7a6536fd50a905094fecb83e7cb2c53100c256f8cad1cad4f51e8` |
| `paired_observation_model.json` | 2771 | `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b` |
| `generation-provenance.json` | 4394 | `46e13d23b461b8d64299803a809b2f4f9c6187c4cb7d7a59cbd3f21799e0fa58` |
| `generation-prompt.zh.txt` | 1716 | `4dd60bda58a58d90474beb76a692763c8a83f31cdfc6a5afdf35a9c5ee36b13b` |
| `test_astra_generated_comparison.m` | 20716 | `45ad81b82ac9a60ff8ccfcf1da1cbffc94567f7ea02656328735ed6864a3f75d` |
| `measure_comparison_plot_data.m` | 17824 | `926340eab762d07f617e9223f3f56100701ab7bb1f2f29ba63ce327d818dfe46` |

The provenance records CLI 0.153.4, provider identifier OpenAI, both turn contexts `gpt-6-astra/high/never/danger-full-access`, and thread `01a07422-6d4a-7052-8d6a-993e40f9d46a`. These are recorded generation identifiers, not independent attestation of remote model architecture. The original report's claims are not native execution evidence. Original 10 x 8.5 inches and temperature labels are legitimate model choices, not violations of an imposed 8 x 5 fixture contract.

For the font and suite interpretation, GitHub raw files at the exact CI commit were also byte-compared: `oi_font_available.m` SHA `03ec985b69be5609d10f1ba65cd447d556508da16ab6069bcf7778b4b5f1b313`; `diagnose_font_exports.m` SHA `8745ebe6805f64d050cc665b383aa88e8ebe8fca015194ac0db720e3b0e53f5b`; `test_comparison_native_evidence.m` SHA `fba76f79cc155e26d0d1cdbec0ed53ae00ae7e8369a0b59881ca8780a62121ee`.

## Font evidence, not a missing-font conclusion

Each same-run `font-export-probe/font-export-probe.json` reports five available candidates, zero skips/failures, and 16 successful exports; all 48 actual files match recorded bytes/hashes. The candidates are Noto Sans CJK SC, WenQuanYi Zen Hei, Droid Sans Fallback, DejaVu Sans, and Liberation Sans.

| Release | `listfonts_match` among five | `font_available` among five | `exportgraphics_file_type` |
| --- | --- | --- | --- |
| R2021a | 0/5, no listfonts error | 5/5 | 6 |
| R2024b | 0/5, no listfonts error | 5/5 | 6 |
| R2026a | 5/5 | 5/5 | 6 |

The bound helper first checks exact case-insensitive enumerated names, then on Unix uses safely quoted fontconfig and exact family-alias matching. Old-release false enumeration plus true availability therefore exercises the fontconfig route, not arbitrary substitute acceptance. It does not prove that the whole `listfonts` list was empty. The generated extra enumeration-only assertion is narrower than the project availability contract and is the observed blocker.

The bound theme prioritizes WenQuanYi Zen Hei. Its selection in the failed old Astra calls is an inference from the resolver and same-run probe, not a captured trial FontName; R26 actually records that FontName. R26 also records PPI 96 and DISPLAY `:97`; old font probes report PPI 72. No causal claim that PPI or release alone determines enumeration is justified.

Targeted external inspection of the old releases' independent WenQuanYi probe PDFs used `pdffonts`, `pdftotext`, `pdfinfo`, and in-memory 108-DPI Poppler renders, not evaluator/Astra substitutes:
- `exportgraphics-vector-pdf` embeds subset `EAAAAA+WenQuanYiZenHei` (CID TrueType, Identity-H; emb/sub/uni all yes). The CJK title `\u5357\u6d77\u6d77\u8868\u6e29\u5ea6` extracts correctly and is readable in the inspected render. Its actual 382 x 182 pt page is content-cropped, not exact 6 x 4 inches or the Astra page.
- `print-painters-pdf` and `print-default-pdf` list unembedded Courier Type 1, WinAnsi (emb/sub/uni all no), on a 432 x 288 pt page. The CJK title does not extract, yet remains visibly readable in the inspected painters render. Failed extraction is not proof of absent glyphs; the font embedding defect remains.
- These observations concern specific probe files, not full layout/visual approval or old Astra exports. Probe embedding/glyph/visual flags remain untouched. R26 font-probe file hashes were checked, without extending this targeted external PDF inspection to its full matrix.

WenQuanYi PDF SHA-256 anchors (painters / exportgraphics / default):
- R21: `741aa4f55ff01488f25826c4fc62e76f4e3ebe550c64f6d67f73bbe0d0d19288` / `679bef6eb73957ed6b46180c92fbd10661c3a10ad9950f84867e3884f1ba212b` / `24d36ff08520ae5e8653db336da027242ca9ea1189b8606230e17e8f4c3c6bef`.
- R24: `49e0f470f8d682557e3e2a504a7532971eb29c9cfafd60b145b805d51ab3886f` / `2853db4bb6c746f3e9ba040a3c96588b17a7b1ec72a26b1831bff3b2b0212c14` / `62d6d6fb9b0ae0f74cf845e7a473237207423c6f4b4b2650ec53cee0dd7b75da`.

## R2026a actual model trial

- The trial evidence records `status=passed`, `phase=complete`, call/execution true, native proof `passed_before_and_after_export`, exports `completed`, manifest `passed`, and original files unchanged. The actual log terminal marker independently agrees.
- Parsed before/after native v3 evidence is identical: 12 records, 11 finite scatter pairs, all source-row IDs/UTC times/depths retained, last observation null but last model value 13.96 retained, all observation QC/U records, and 11 horizontal uncertainty segments. Model QC/U remain `not_provided`.
- Figure snapshots before and after agree at 10 x 8.5 inches with `Observation temperature (degC)` / `Model temperature (degC)` and profile `astra-temperature-labels`. No source relabeling or resizing was introduced to fit the old fixture.
- All three exports record the real API `exportgraphics`. Actual PNG header: 3000 x 2550, stored density 299.9994 DPI; actual PDF: one 720 x 612 pt page; parsed SVG: width 3000px, height 2550px, viewBox `0 0 720 612`, physical metadata 10 x 8.5 inches.
- The single manifest figure `paired-observation-model` binds the trial exports and data declaration; actual file bytes/hashes agree. These are genuine trial outputs, not borrowed evaluator artifacts. This review does not mark Astra visual/font-embedding/Desktop approval; both trial visual/Desktop flags remain false.

| R26 trial file | Bytes | SHA-256 |
| --- | ---: | --- |
| `paired-observation-model.png` | 216693 | `12301f81728a6321b0c4ad868979f34b5233bbea5c3b749ae7d0c37aa7d966c7` |
| `paired-observation-model.pdf` | 16008 | `edead8fef2e3a155e052a1933e02cae49e0831bb1ba471e6a2f4bc693383233e` |
| `paired-observation-model.svg` | 41494 | `050d0318ce009cfcda5eedd636424c6a4d5358cb6815f36c6a9648aba64aa2b4` |
| `figures.json` | 28508 | `f8405986f886482eb598e0665c2e8b39203184d61e8dde52b207a93998ad096b` |

## Evidence integrity

Evidence JSON SHA-256 (trial / adversarial suite / font probe):
- R21: `df535bc45066580b04ef0919143cccd7fe1f6688f7776aa147bdd421599a44dd` / `102c6f822f7775547653f8c0dcd59dfc7d336d35920b843a0c0e291adb7b185a` / `3a50817417b9b8d8a452d5efd22c34c25a6b468c88600456aced94a18d659c2d`.
- R24: `9a3b3cc23f760af399dd1c25c83199557038e96ac4315cd2498f81dd90838b56` / `850591042394e85aaf83913def3826b84987ab6b9f13b3a24c78995cf23534dc` / `98c21fd0fb66dd9a75a62a25a03c92bfb64ae92be383dc0c7c4efb3d6a2c892c`.
- R26: `9b5d6c07fb2e5eb6c7a74aed1a2abd03bf55f627d2e792cb896fc73a7cf4bb7d` / `f5812787281d77c36f9ae48bb5daf6db57d3efcd6a4dc93e5a2d493a2f5cedc9` / `d68cdf07d8f6c20fae0eb8affc766eeb1f31b37ffbe06b332653a45e290fbb4c`.

Raw job-log bytes/SHA-256, obtained via `gh api repos/wzn1118/ocean-intelligence/actions/jobs/{job}/logs` without writing into artifact packages:
- R21: 788593 / `2d01ba1b3aa91fad5e492b178b171a3e5e6a779325ba33549a95179cc7dc2a45`.
- R24: 789425 / `1e915cb7ac93a67d747a60291c60ef14bd607737fdb4ff7d565e4ac975f76827`.
- R26: 878084 / `391e98b9cf9f6a0a97c8ac74da612d1ea87ae0eef5e5ea4bd1d0e52fb1f8e0f9`.

All 1099 original files were rehashed after inspection: R21 376, R24 364, R26 359; no additions/deletions/byte changes. Inventory digests below hash compact recursively key-sorted JSON mapping each package-relative filename to `{bytes,sha256}`:
- R21 before=after: `22493a45ec86edbdcf04c3f04d520f871751fb52bde18c25a77d90c5dcce95c0`.
- R24 before=after: `3bbf4ee0ae82421c34cf3a44206b4569f50b97db342eb90572a4cf6ed80f760c`.
- R26 before=after: `da920187aad758172d9170ced48c0e7fd677ad24c1bab92b43296ae653dc26d4`.

Only this report is written. No generated archive, driver/profile/helper, original artifact, score, or visual flag is changed. The coordinator-owned real Astra continuation remains the repair path; no hand-written repair or unexecuted candidate is declared successful.
