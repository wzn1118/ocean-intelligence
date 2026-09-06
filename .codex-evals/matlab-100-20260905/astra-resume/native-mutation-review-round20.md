# Round 20: first native comparison mutation-suite execution

Scope: read-only packages under `/tmp/matlab-run-33999054663/matlab-full100-{R2021a,R2024b,R2026a}`, completed job logs, CI commit `85ab9d20b9fcdecff39e7b2632a1250da6195a6d`, and the reviewed NaN-size candidate. R2026a was added after its original package and completed failure log became available.
No local MATLAB executable is available. This review did not replay MATLAB, repeat the v3 data/visual audit, edit original artifacts, or change tests/readers/helpers/gates.

## Findings

1. **Confirmed primary failure, already addressed in the candidate:** all three releases reject `Scatter.SizeData=0` at the setter, before the reader call. Stage status preserves `MATLAB:hg:shaped_arrays:PositiveOrNanVectorDataPredicate`; the stack points to `test_comparison_native_evidence.m:157`, then `full100_family_b_runtime.m:107`. This is not the expected `run_matlab_gate:ComparisonProofHandles` rejection. Every job remains 19/20; the matrix is 57/60, failure.
2. **Additional confirmed cleanup defect:** error unwinding also invokes callbacks on deleted Legend and Scatter handles. R21 log lines 1013 and 1055, R24 lines 1039 and 1082, and R26 lines 1038 and 1081 start `onCleanup` destructor warnings with `Invalid or deleted object`. They point respectively to the legend AutoUpdate callback at test line 103 and `restore_properties` line 364. The original setter failure remains the stage error; these warnings are not mutation successes.
3. **No further deterministic invalid setter or normal-path reader-baseline restoration failure was found in the remaining property cases.** Their values fit the public property contracts below. This is source/documentation review, not evidence that the unexecuted cases pass on any release.

Cleanup recommendation: make cleanup callbacks tolerate already-deleted handles, or coordinate dependent restoration and figure closure in one ordered cleanup. Keep normal-path `assert_same_evidence` checks and the exact original error. Do not count a cleanup/setter exception as reader rejection. MathWorks explicitly does not guarantee destruction order for multiple cleanup objects: [onCleanup documentation](https://ww2.mathworks.cn/help/matlab/ref/oncleanup.html).

## What actually executed

The final metadata marker is present in all three logs: `MATLAB_COMPARISON_RECORD_METADATA_NATIVE_ASSERTIONS=passed`, R21 line 980, R24 line 1006 and R26 line 1025. The corrected cellstr test therefore returned before entering this suite on each release.
Reaching the first property-case marker proves that the preceding straight-line code completed: exported baseline and `assert_complete_evidence`/JSON round-trip; exported multiline-char-title with numeric face/edge alpha; flat RGB with numeric alpha; edge-only numeric alpha. All associated `assert_same_evidence` restoration checks also returned. These four positive cases are established by executed control flow and artifact presence, not by an absent final suite report.

| Case | Actual reader result in all three releases | R21 / R24 / R26 rejection log line |
| --- | --- | --- |
| scatter-x | run_matlab_gate:ComparisonProofScatter | 1003 / 1029 / 1028 |
| scatter-y | run_matlab_gate:ComparisonProofScatter | 1005 / 1031 / 1030 |
| scatter-id | run_matlab_gate:ComparisonProofScatter | 1007 / 1033 / 1032 |
| scatter-source-row | run_matlab_gate:ComparisonProofScatter | 1009 / 1035 / 1034 |
| scatter-hidden | run_matlab_gate:ComparisonProofHandles | 1011 / 1037 / 1036 |
| scatter-zero-size | Setter failed; reader not called | entry marker only: 1012 / 1038 / 1037 |

Each subsequent entry marker occurs after the preceding case's explicit restoration and baseline-equality assertion. Thus all five successful rejection cases also passed their restoration checks. The sixth failed at line 157, before `assert_reader_rejected` at line 159; no assertion validates restoration of that failed case.
Coverage on each release is **four positive cases and five of 36 intended reader-negative cases**, not suite passed. The other 13 property cases, two extra-object cases, two wrong-parent cases, wrong-exported-figure case, and 12 returned-record/metadata cases were not reached. The final restored-baseline check, final original-artifact hash assertion and success markers were also not reached.
Each test directory contains exactly eight files: baseline PNG/PDF/SVG, char-title PNG/PDF/SVG, the consumed input JSON and `baseline-test-evidence.json`. No package contains `native-reader-test-results.json`; no job log contains `COMPARISON_NATIVE_READER_TEST_NEGATIVES=36` or the suite's final passed marker. Each JSON baseline explicitly keeps visual/Desktop verification false.

## Remaining property cases

The reviewed candidate changes only `scatter-zero-size`/`0` to `scatter-nan-size`/`NaN`. The setter's own error in all three releases explicitly permits NaN. If the setter retains NaN, `all(SizeData(:)>0)` in reader line 101 is false and the intended handles assertion rejects it; that candidate still needs native execution.

| Pending case(s) | Setter and reader/restoration review |
| --- | --- |
| scatter-nan-size | Scalar NaN is permitted by the observed positive-or-NaN validator. Saved SizeData and, when present, SizeDataMode are restored. |
| scatter-unpainted | Face color `none` plus edge alpha 0 are documented values and were each already accepted in the preceding positive controls. Both painted contributions become false. |
| scatter-face-flat-alpha; scatter-edge-flat-alpha | `flat` is explicitly supported for both alpha properties; it is not an invalid MATLAB enum. The reader intentionally requires numeric scalar alpha and rejects this supported but unverified rendering mode. |
| scatter-indexed-flat-color | CData `(1:11)'` is a valid per-point mapped-color vector for 11 points, not an invalid RGB triple. With face `flat` and edge alpha 0, the reader's three-column truecolor requirement rejects it. Original CData, face color, edge alpha and CDataMode are restored. |
| axes-hidden | Axes Visible=`off` is supported; children need not become invisible. The reader explicitly checks the axes Visible property, so it need not rely on child disappearance. |
| segment-left-endpoint; segment-right-endpoint; segment-not-horizontal | Only finite values in an existing two-element XData/YData vector change; lengths remain matched. The reader compares exact endpoints/horizontality. Saved vectors restore them. |
| segment-source-row | UserData accepts a struct. Changing only its SourceRow to 12 is setter-valid and contradicts the reader's selected-record identity. The complete saved UserData value is restored. |
| segment-hidden | Line Visible=`off` is supported. `findall` still counts the line, so rejection belongs to the segment visibility assertion rather than line-count failure. |
| title-wrong-text | Legend title String accepts the replacement character vector. It remains a live title object but fails the required two-line explanation comparison. The original String value is restored without reformatting. |
| title-hidden; legend-hidden | Both Visible properties accept `off`; neither mutation deletes its target. The reader explicitly checks both visibility states, and saved values are restored. |

Public references, read with curl and a structured HTML parser: [Scatter properties](https://ww2.mathworks.cn/help/matlab/ref/matlab.graphics.chart.primitive.scatter-properties.html), [Line properties](https://ww2.mathworks.cn/help/matlab/ref/matlab.graphics.chart.primitive.line-properties.html), [Axes properties](https://ww2.mathworks.cn/help/matlab/ref/matlab.graphics.axis.axes-properties.html), [Legend title properties](https://ww2.mathworks.cn/help/matlab/ref/matlab.graphics.illustration.legend.text-properties.html). These current references support candidate legality, not completed execution of the remaining cases.

`property_state` already captures CDataMode/SizeDataMode behind `isprop`; `restore_properties` restores values first and then saved modes. The actual helper supplies explicit size/color and manual X/Y limits. Legend AutoUpdate stays off during negative tests. No additional mode-restoration patch is justified by this inspection. Reader-evidence equality does not establish equality of every automatic layout/paint property or rendered pixel.
The later copy/delete cases and returned-struct cases contain no further zero-size or other analogous prohibited setter value. Their expected errors and restorations remain untested in this run. In particular, row-12 deletion, fabricated model uncertainty/QC, and bias mutations must not inherit the five earlier scatter-negative successes.

## Evidence anchors and preservation

CI test source SHA-256: `63cb34b817c9400bb0ab2079a4ce6ec34b035bd039dfd2cc79cc3a8c77fef6f6` (21128 bytes). Reviewed NaN-only candidate: `8b8c56c8ecfeec113d9e8c1d127401847de2608e150b0d3d0c9d665be362937f`; exact comparison against the GitHub commit confirms only the named zero-to-NaN case changed. Reader source matches CI exactly: `e522e494c243ea105b399c03aa826a050200ae77d54ee7ee6ea55742a7dd25e3`.

| Release | Original evidence | Bytes | SHA-256 |
| --- | --- | --- | --- |
| R2021a | job 101394625930 log | 815046 | `af7c4c3a9722240e9c90813e38f462db380c0e9fec54a4d2cb1342be19f3bd5a` |
| R2024b | job 101394625990 log | 816706 | `cdab3cb3a48a962756d384b70217ece601117afcb0795cc20e3786e7f4e1cf40` |
| R2026a | job 101394625952 log | 847795 | `166e069f05e06ea9c5495b919fcbbb86f5e4106610e64cb68a475c6f31db6c74` |
| R2021a | ci-stage-status.json | 5030 | `2686138606c9130e1c8640dd6629481a8a7b39caa3c162567d8216f6bbabf1c2` |
| R2024b | ci-stage-status.json | 5527 | `a7766d316165f579f6ac5e0851c58a30282609268903922e0614a0dcb8656d07` |
| R2026a | ci-stage-status.json | 5527 | `7f85d2eb44025e65f5c8622c7a524d17bc0e6537edad8d9195cdae096d029924` |
| R2021a | baseline-test-evidence.json | 4168 | `7bf3cce9a36e2eec47b74b790fcdfb5c2c5ad3569e7524aaf6f5547a73fcf67a` |
| R2024b | baseline-test-evidence.json | 4168 | `0f002fb1cb62e3ca97d9a990b79acdf93d92e856c8f58a76d1d0d9a055673233` |
| R2026a | baseline-test-evidence.json | 4168 | `79cb9d2b29a2e077173b7e043f33ec7091144d54968d44b7e9e5206ffeca346f` |

The baseline JSON files are under `family-b/comparison-native-evidence-adversarial-test`; all three consumed input snapshots are 2771 bytes, SHA-256 `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b`.
Before/after review inventories match for all **999 original files**, including all 18 partial-suite figure artifacts. Inventory hashing uses SHA-256 of UTF-8 `json.dumps(files,sort_keys=True,separators=(',',':'))`, with package-relative POSIX keys and `{bytes,sha256}` values:

| Release | Files | Before = after inventory SHA-256 |
| --- | --- | --- |
| R2021a | 331 | `d549354d08882faa196999160563ee574ff1f06fae51389e4c3733640a748bc9` |
| R2024b | 319 | `a4b6c2833d17a5f057a9bb25c4d17fff9f88c945bc5a9d8cc07b145c95499926` |
| R2026a | 349 | `e4697532cf5b62b20908fd7f5c1d758e261c6f741508f8f96c0454e3af0048fb` |

Next native evidence must include rejection of `scatter-nan-size` by the reader, all remaining cases with restored-baseline checks, the complete results JSON, final artifact-hash assertion and final suite marker. Until then, neither documentation nor the candidate edit upgrades this first partial run to passed.

## Authorized cleanup-only follow-up

After the read-only review, the coordinator authorized a narrow test-file fix. `restore_properties` now returns only for an invalid `handle` object; valid handles still run both original value/mode restoration loops. Legend AutoUpdate cleanup now uses the same guarded restoration with its saved property state. No catch was added, and the reader error checks, normal-path baseline assertions and existing `scatter-nan-size` case remain unchanged.
Updated `codex-runtime/matlab/tests/test_comparison_native_evidence.m`: 21198 bytes, SHA-256 `4ad842e4dce727264f822e9fa50825dfecf320d01abc65d891f9cee99cdb65cd`, replacing the NaN-only candidate hash recorded above. Reversing exactly these two edits reproduces that earlier hash; this checks preservation of every other source byte, including the existing assertions.
Validation: `mh_lint --brief --input-encoding utf-8 --matlab 2021a codex-runtime/matlab/tests/test_comparison_native_evidence.m` completed with exit 0: one file analysed, no issues. Source is ASCII. This is static validation only; neither the cleanup-error path nor the complete mutation suite has been rerun natively for this candidate. Original CI packages and their failure records, production reader/helper and scoring remain untouched. No commit was made.
