# R22 Fixture Canvas 原件及恢复策略审阅

## 优先结论
- 原件为 **R21 run34001173593**。R24的baseline/DISPLAY各4case均只完成reference PNG/PDF的print，随后RootObjects失败；**canvas原生exportgraphics一次也未执行，panel包装、restore及restored PNG均没有运行证据**。主stage通过不能替代这个附属诊断。
- **额外确认的阻塞：** R24 profile/comparison在两context的constructed、before_wrap共8份geometry均为capture_failed，错误为`MATLAB:class:GetProhibited: No public property 'Position' for class ''Text''.`。不是只有AnnotationPane门禁失败；单独排除空pane后，这个getter问题仍须解决，不能把现有快照标captured。
- 空AnnotationPane可作为**两旧版隔离候选的受限排除项**，前提是运行时确认目标class/Tag且`allchild`确为空；非空、无法读取、未知对象必须拒绝。现有原JSON没有DirectChildCount，不能由scribeOverlay标签或HandleVisibility=off补签“已证实为空”。
- R21两个context各4case都在builder的JVMRequired检查失败：无figure快照、无参考或canvas图件。不以R24图或旧simple图补位。

## 实际阶段及范围
- B=`native-pdf-page-probe/native-fixture-canvas`，D=`display-comparison/native-pdf-page-probe/native-fixture-canvas`；前缀为`/tmp/matlab-run-34001173593/matlab-full100-<release>/`。
- H=`crossed-time-depth-temperature`，P=`repeat-cast-salinity-profiles`，C=`paired-observation-model`，I=`paired-interactive`。每个目录有candidate.json，context根有native-fixture-canvas.json；本报告的baseline JSON指B路径，不涉及36suite的baseline-test-evidence。
- 实际逐张view_image查看R24 **8 PNG+8 PDF预览，共16原件**。PDF以Poppler 22.02.0运行pdfinfo -box、pdffonts、pdftotext -layout/-bbox-layout，再用pdftoppm -singlefile -r 150 -png渲染到`/tmp/fixture-canvas-round22-hjrciK/<代号>-pdf.png`；原件未改。

| 原生记录 | R24 B/D各4case | R21 B/D各4case |
| --- | --- | --- |
| reference_png | print(figure,-dpng,-r300)，api_invoked/call_succeeded=true，8件exported；独立读头均2400x1500 | not_attempted，无文件 |
| reference_pdf | print(figure,-dpdf,-painters)，api_invoked/call_succeeded=true，8件exported | not_attempted，无文件 |
| canvas_pdf / restored_png | 均not_attempted、api_invoked=false、call_succeeded=false、bytes=0、hash空、文件不存在 | 同样未尝试、无文件 |
| geometry / root inventory | 只有constructed/before_wrap；root_inventory均captured；wrapper_geometry为空 | geometry为空，无root inventory对象 |
| 数据/恢复 | after_reference=true；其他data节点不存在；restoration_attempted/completed、root_state_preserved、parent_identity_preserved均false | data为空，恢复均未尝试 |
| candidate / context状态 | 8候选failed，RootObjects；2context incomplete，counts_toward_stage=false | 8候选failed，JVMRequired；2context incomplete |

- 16份candidate均与各自context总JSON中的对应记录完全相等，16个现存参考图hash均匹配原声明；没有根据参考图替canvas_pdf生成成功记录。
- R24 H/I两context共8份geometry为captured，constructed→before_wrap逐字段相同；P/C共8份仅已采集的部分记录及错误相同，**不是完整几何不变**。H/P/C/I的已记录对象数分别162/162/172/159。
- P/C失败发生在普通对象和4个layout.Text记录之后，错误指向Text.Position；结合命名对象枚举，疑点是Legend.Title。原JSON未记录失败对象的完整class/owner/id，不能冒充已原生定位到具体handle。新采集应区分公开可读属性与isprop存在性，保留unavailable原因；不得删掉特殊Text、填零边界或吞掉其他getter错误。

## 参考图实际问题
八份PDF均单页、MediaBox/CropBox=[0 0 576 360]pt、rotation=0；pdffonts每份仅列`Courier / Type 1 / WinAnsi / emb=no / sub=no / uni=no`，Producer均Apache FOP 2.4.0-SNAPSHOT。**尺寸正确不等于字体正确，更不是尚未生成的canvas PDF证据。**

| 原件 | reference PNG实际所见 | reference PDF实际所见 |
| --- | --- | --- |
| 24B-H | 长标题/深度ylabel/色条标签完整；白色缺测格可辨。 | 标题右端裁切，抽取只到“dep”；bbox右端577.800pt越576pt页面。其余轴/色条文字可读。 |
| 24D-H | 标题和轴标签完整；色条刻度较B稀疏。 | 同样右裁，标题bbox右端578.412pt；PDF色条刻度与本版PNG不一致。 |
| 24B-P | 长ylabel完整，三日期图例在右侧，三种线型可辨。 | ylabel顶部被页边裁掉，抽取止于“synthetic s”；日期图例仍可读。 |
| 24D-P | 长ylabel和图例完整；y刻度每10m。 | 同样ylabel上端裁切；PDF每20m刻度，不能把before/after源状态相等解释为跨格式相同。 |
| 24B-C | 长标题、三行统计、图例双行标题完整，未见盖住数据；数据区较小，短不确定度线部分贴近标记。 | 长标题右裁，bbox右端580.700pt；图例标题越右框，底行文字与线型样例相碰。三行统计仍可读。 |
| 24D-C | 中文未涉及；长英文标题/三行统计/图例完整，第三行统计较贴近轴顶但未盖点。 | 同样标题右裁（bbox580.812pt）、图例文字越框及底行相碰；不是空pane造成的新包装缺陷。 |
| 24B-I | 中文/英文layout标题完整，五个有效点、误差棒及NaN断段可见，两端有留白。 | 中文/英文标题视觉完整，曲线/误差棒可见；但整条layout标题没有被pdftotext抽出。 |
| 24D-I | 标题、端点和误差棒完整，线/点边缘较明显锯齿。 | 标题视觉完整但同样未抽取出中英文标题；轴刻度/标签可抽取，仍只有未嵌入Courier字体记录。 |

- I的标题对象现已在JSON中具名记录：layout.Text、String完整、WenQuanYi Zen Hei、FontSize=13；Units/Position/FontUnits/Extent不可用。这证明此次不再漏掉标题对象，不证明公共几何已测、PDF标题可检索或WQ已经嵌入。
- P的PDF抽取bbox没有报告负坐标，但实际图面和抽取的残缺ylabel都证明裁切；不能用“已抽出word均在页内”代替完整文本检查。H/C标题及C图例的问题也发生在reference print阶段，未涉及任何canvas API。
- B/D可见刻度密度、图例位置及栅格边缘差异；未把这些差异归结为DISPLAY单因素，也不签PNG/PDF视觉一致或色觉可访问性全通过。

## 空Overlay与恢复边界
- 所审原版根清单包括1个layout、1个`matlab.graphics.shape.internal.AnnotationPane`（Tag=scribeOverlay、Visible=on、HandleVisibility=off），以及菜单/toolbar；H/P/C还各有ContextMenu。记录中未发现以AnnotationPane为parent_class的已枚举对象，但before_wrap沿用构造时冻结的原对象清单，且P/C有截断，**不能据此证明print之后pane的实时子树为空**。
- 阅读期间主线程候选已增加DirectChildCount，并以`isa(AnnotationPane) && Tag==scribeOverlay && isempty(allchild(object))`决定排除。非空pane不被排除，随后不能通过axes/layout root门禁；这个窄条件可进入隔离CI。此内部class没有本报告可依赖的官方稳定绘制契约，不扩大成通用/跨版本白名单，也不把尚未实跑的child计数回写旧JSON。
- 官方allchild包含隐藏子句柄，不能改成Children、仅查Visible=on或按Tag排除。非空pane可能装科学annotation文本/箭头；官方annotation支持figure/panel/tab，且跨panel边界会裁切，不能随意搬迁或删除来通过门禁。[allchild官方文档](https://www.mathworks.com/help/releases/R2024b/matlab/ref/allchild.html)、[annotation官方文档](https://www.mathworks.com/help/releases/R2024b/matlab/ref/annotation.html)
- 当前菜单排除只针对uimenu/uitoolbar/uicontextmenu类型，是**留在原figure而不包装**，不是删除菜单或递归删子树。不能推广为排除所有hidden对象：C的真实不确定度Line也有HandleVisibility=off，H的Image、Legend/Colorbar、layout标题均须留在科学图对象集合内。遇到未知根或排除根下出现科学绘制对象应失败，不改HandleVisibility“清理”清单。
- 空性至少在迁移前drawnow后取证，导出前后也应重查排除根身份/子树；导出或回调新建的annotation不在冻结originalObjects中，现有same_data不会自动发现。建议原生负例为在同pane下放真实annotation后必须RootObjects失败，且annotation句柄、Parent、String和源字节不得变化；本机未执行该负例。

| 四fixture恢复约束 | 所读候选已覆盖 | 仍不能认定完成的部分 |
| --- | --- | --- |
| H温度场 | 原Image X/Y/CData、AlphaData/映射、CLim/Colormap、方向/尺度/limits/ticks与原句柄比较；不重建axes。 | 色条自己的Ticks/Labels/Layout关系未完整纳入data字段；本轮仅reference后比较，未包装/恢复。 |
| P剖面 | 原Line数据、线型/颜色/DisplayName及图例String保留；长ylabel文字/字体参与比较。 | Legend.Title几何getter实际失败；图例Layout.Tile/Location及后代位置的恢复仍待测。 |
| C比较 | Scatter、隐藏不确定度Line、原X/Y与UserData身份、axis equal相关aspect ratio、Subtitle和Legend.Title文字参与比较。 | 没有appdata角色与全部tile关系的独立比较；数据区/图例PDF视觉已失败，不能以数值相等替代。 |
| I交互 | 原datetime Line/ErrorBar及deltas、CapSize、limits（含4%端点余量）、具名layout标题保留，不replot。 | OceanInteractionState、DataTipTemplate、BrushData、callback生命周期未验证；模板明确Interactive=false，不能批准Desktop。 |

- 源码已保存原Parent身份、CurrentAxes，并在restore后检查root精确几何、原Children顺序和原对象Parent；原data_state用isequaln比较，无同值重画替代。这些改善**仅after_reference在本包有成功执行声明**，其余恢复字段仍false/未尝试。
- 风险仍需保留：只主动恢复root几何；六geometry节点仅要求captured，未比较所有后代位置。parent/root检查在删除panel之后，异常循环会在首个restore错误停止；原hidden child顺序及新增对象集合不是完整恢复断言。用于独占fresh fixture可保留失败诊断，不能直接推广为接收调用方figure的生产恢复方案。
- R24四case的输入hash均匹配同包fixture-inputs的三份原始fixture副本（H/I共用温度fixture）；只核对字节绑定，不复算统计或重跑科学数据套件。after_reference=true是实际MATLAB自比较声明，不是本机独立重执行。

## Hash绑定
下表B/D对应上述路径，图件均为原reference.png/reference.pdf。canvas.pdf与restored.png在两个旧版全部缺失，不能提供hash。

| R24 case | candidate.json SHA-256 | reference.png SHA-256 | reference.pdf SHA-256 |
| --- | --- | --- | --- |
| 24B-H | `f7ee55a4a93efbb1d6a836032be74572be18832819bf4bbe4c03d401d1151fec` | `3ec4ab031e351f9e1e0a8fec10d975a17dfd8379f3a5cf75543d37ac7535f868` | `6d74ecf136eb648aefd0e8996a5a06f582134f8d806834d8de0ad31646aeeb18` |
| 24B-P | `e4dafbca0906aaa50b6e5299f1e418716bce3472aae7cfb570c7d83edaa53357` | `70decc837f5cf458e2925d590a91512ac426b9ebd1410ebaa920ee14a11365ed` | `9f6f93b78f21387c24ca3a60c246f9cafcad92138a3d8dc6f11acecf6101c3db` |
| 24B-C | `59208a61f77ed097b511a90a32c3a29463a2aa175438fc2926b1115e04b0355e` | `269cd3b5fc4aef9105b6d3a15058b7e77daed8daf3bef80e4e9754cc30eaa90d` | `32d51ea65896784112beed08c841c4b75d8c4f262503a683dc9c3ef56f137d4a` |
| 24B-I | `65e53f9099f1cb751caa4cb565836c028dd87177f7884c81ab6bd99cb9dc7550` | `ff90d093bde9f5c63a9b9b32159125851667a6f2e4a676008f6d5bc5de6f1f9b` | `ef7791b32da9110ff4ad57bcb0f9c6c695cfe66f08a5f0acd4ea7dadce310f67` |
| 24D-H | `7d3d107c7eb7fbab076fdae1a5dd7ebe8554744d93db578a655ac0c1125c0e88` | `0766978a360fb74c373996eca0446fb829a684f15b67e23b98b10dc1723b3859` | `3e26b31124c1fff7cbf59c2b02bacf463fef79ce17a9f838343cb4971dab13f5` |
| 24D-P | `5d927a9e3ee13494dac2a5564cf2bc04c0ac5ed2d8f754e73a90d831d4be6e29` | `f963db8955b3b76d4e56072f912db1de37d5f82731664cc1fe66b12f60f519a9` | `8dc6c7d52737b91f00b900cb0d1d1c4afee792240566afd03f881295ee47b6d0` |
| 24D-C | `824f124a054e8fa75cf618867a2a207f93ff4d952b43f161c33a56efade79695` | `bb770ed72f2f7b77320e740c1bcab3cf3837d2fd3efea4d6cd2f427a3893676f` | `a19a2c186e2814057097c6cc85fdbdadf787b88b8c58142049fc88a3468ffc9b` |
| 24D-I | `bedfb4bc6c85774e344ae40b20c095e8c6f78e6b3d4e1b915d6c982ca98717a4` | `902cd2ef338468e8de6e5e391213d351ad2c8888ed8d7e58b0b474b2e626e736` | `c6bea06ea473eb420915d3ca45a613f1d4a7630d4848f9c36ee88b54c820d24b` |

R21无图件，仅绑定实际失败candidate.json：

| case | R21 B JSON SHA-256 | R21 D JSON SHA-256 |
| --- | --- | --- |
| H | `97de725a06a6f75a5d91065ea761d004ad88753cdd44abe9cf96044ad7734f16` | `97de725a06a6f75a5d91065ea761d004ad88753cdd44abe9cf96044ad7734f16` |
| P | `c1b743c1debdafb03c6d9cc4d94a606dd532490e478d0c4fa0b86eed61b0f84a` | `c1b743c1debdafb03c6d9cc4d94a606dd532490e478d0c4fa0b86eed61b0f84a` |
| C | `fb71cdf37e24986bcb77fa5224e2c10da7ea42a8871574415303cf7db54dd1d2` | `fb71cdf37e24986bcb77fa5224e2c10da7ea42a8871574415303cf7db54dd1d2` |
| I | `cc5e74c943d7f022e2f0e04afc29e2d74d31af4731322774b040cc5d93fe4026` | `cc5e74c943d7f022e2f0e04afc29e2d74d31af4731322774b040cc5d93fe4026` |

| context总JSON | native-fixture-canvas.json SHA-256 |
| --- | --- |
| R21 D | `46c1ff1d14485a1960d755647b738666e8e3e2a3dd08176444cb1f035a645926` |
| R21 B | `f7ff1272c70add0b3d758193ea9d43b85c46e66baadb605c773df4cb788ee851` |
| R24 D | `5f1900fdb6a28b20118592152801fe4007d9ae6800382ed9bfe59998c5a3f190` |
| R24 B | `4ae30dc83885472d64c9bdb45b1021c1208f24f524d30c9df097b07f60d2f015` |

| 同包R24 fixture-inputs副本 | SHA-256 |
| --- | --- |
| crossed_time_depth_temperature.json | `ca8ff03c0fc54351bcd7055546c5f2a84ccdb3b4d88882a660820ac779307a21` |
| paired_observation_model.json | `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b` |
| repeat_cast_salinity_profiles.json | `8c30bc832e0c958ea0795466e18a382ff6452998d57e9d4322d2775678135943` |

- 范围内39原件（16参考图、16candidate、4总JSON、3fixture）全部审计前后hash一致。未改任何原件、source、score/audit、生产exporter或旧报告。
- 读取的T源码初始SHA=`eefe120cecbad5fac88ec8b086d1f3ce95becdee45de2626f98b8b1a1457f323`；主线程加入空pane排除后的已审SHA=`19062ee1b3d391a633bb8aa13a13ad4453dbcb2eab5b04a357facaae1d02984f`。[test_native_pdf_fixture_canvas.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:107)
- builder初始已审SHA=`152e8e687bb41bdc71650b91e86255d58b0da953fa03c9cc9062c8d7c0402362`；Huygens随后候选SHA=`3430dfece920c46d9161d07dc38ddf85ea5e0757f02648a57162f85d7b73475c`，已读其diff：改用字节临时副本+oi_sha256_file并反复校验，移除强制JVM。**这不是R21新原生执行证据**，不改变本包无图事实。[build_native_pdf_fixture_case.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/build_native_pdf_fixture_case.m:165)
- 源码由各所有者并行更新，上述SHA只绑定实际所读快照；旧设计报告SHA仍为`60f831c90787074dd5c5b5b2ae1ba6107b01058fea439a499d3d8de8cfb468ed`，未改写。无MATLAB本机执行、无trusted visual/Desktop批准、无提交推送；唯一新增交付为本报告。
