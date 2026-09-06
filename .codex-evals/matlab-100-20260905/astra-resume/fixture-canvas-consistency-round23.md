# R23 四 fixture canvas 实物与声明一致性审阅

审阅日期：2026-09-06。唯一运行包：`34002693563`。这是对已下载原件的离线只读检查，不是 MATLAB 重跑、人工视觉验收、PDF 页面/字体认证或评分。三版 primary/display 均已覆盖适用性；未解析或审阅模型 trial，未借用旧包，未下载、修改原件、修改评测或提交。

## 可证实发现

1. **恢复 PNG 存在实际空白，不能用声明完成代表恢复成功。** R2021a primary/display 和 R2024b primary 的全部四 fixture，共 12 张 `restored.png`，实际解码为 2400x1500、RGB 每通道极值均 `[255,255]`，即整张纯白；对应 `reference.png` 全部非纯色。这 12 张文件均为 14,021 bytes，原生仍声明 `exported`、`api_invoked=true`、`call_succeeded=true`、`completed_diagnostic`，没有原生错误字符串。异常定位在最终 `restored_png` 产物内容，不能据此归因具体 MATLAB API、JVM、root 排除或渲染器。`root_state_preserved`、`parent_identity_preserved` 及已序列化几何相同，均不足以证明恢复后的图像保留了内容。
2. **inspector 的完成结果没有覆盖上述空白。** 四份旧版报告均返回 `declaration_consistent`，不是 schema 误拒绝。当前 [inspect_fixture_canvas.py](/opt/ocean-intelligence/codex-runtime/matlab/evals/inspect_fixture_canvas.py:244) 仅检查 PNG IHDR/CRC/尺寸，没有解码像素；其 [NOTICE](/opt/ocean-intelligence/codex-runtime/matlab/evals/inspect_fixture_canvas.py:49) 已明确这一范围。因此此处是实际暴露的像素覆盖缺口，不能把 CLI exit 0 升格成产物恢复、布局或视觉通过。本轮已向主线程报告，未改检查器或放宽 schema。
3. **GetProhibited 不再早停，但几何仍不完整。** 两旧版、两个 context 的 profile/comparison 都将 `matlab.graphics.illustration.legend.Text.Position` 保留在 `nonpublic_properties` 和 `unavailable_properties`，没有测量值。comparison 对象的文本正是观测标准不确定度/模型未提供不确定度说明；其位置不能被签为已验证。`captured` 只表示本次允许范围内完成采集，不表示所有几何可读。当前 [inspector 的 nonpublic 检查](/opt/ocean-intelligence/codex-runtime/matlab/evals/inspect_fixture_canvas.py:154) 接受这种明确缺项，没有把它伪装成已测量值。
4. **R2026a 不适用，不是四 fixture 成功。** primary/display 子报告均 `not_applicable`、`candidates=[]`；两次 CLI 均 exit 2、`not_applicable`。`skip_reason` 原文为 `old_release_experiment_only; retain existing exact exportgraphics strategy`。没有该实验的候选/参考/恢复产物可供签署，也没有在本轮独立验证该 skip_reason 所述的 exact 策略。

R2024b display 的四组参考/恢复 PNG 解码 RGB 完全相同，但文件 SHA256 均不同。这里只报告字节及像素比较，不判图中文字、布局或科学表达正确，不替其它 release/context 补位。

## 固定路径、运行入口与证据

原件根目录分别为：

- `/tmp/matlab-run-34002693563/matlab-full100-R2021a`
- `/tmp/matlab-run-34002693563/matlab-full100-R2024b`
- `/tmp/matlab-run-34002693563/matlab-full100-R2026a`

primary 固定子报告是 `native-pdf-page-probe/native-fixture-canvas/native-fixture-canvas.json`；display 在此前加 `display-comparison/`。没有接受 payload 提供的任意报告路径。下文产物表中的相对路径均以相应子报告所在目录为根。

六次独立 CLI 使用相同入口、显式 fixture root，输出到独立目录。示例（其它 release/context 同样替换，已执行结果不覆盖）：

```bash
python3 -B /opt/ocean-intelligence/codex-runtime/matlab/evals/inspect_fixture_canvas.py \
  --artifact-root /tmp/matlab-run-34002693563/matlab-full100-R2021a \
  --fixture-root /opt/ocean-intelligence/codex-runtime/matlab/evals/fixtures \
  --release R2021a --context primary \
  --output /tmp/fixture-canvas-consistency-round23-K9tVkP/R2021a-primary-inspection.json
```

每次的 `*-invocation.json` 保留参数、真实退出码、stderr。检查器 SHA256 为 `a733bb5b22287abf2dfc93455a4958027471ebb893654ac37e837f0ddcb311db`；所导入 `inspect_rendered_artifacts.py` 为 `1000e7a9cbd40638319bf4549dc92a3b13cf807cba632afa0865f4e5739912cd`。

全部审阅输出位于 `/tmp/fixture-canvas-consistency-round23-K9tVkP`：

| 证据文件 | 范围 | SHA256 |
|---|---|---|
| `artifact-geometry-review.json` | 16 候选、64 实际文件的 bytes/hash/header、原生 flags/root/几何缺项及序列化属性比较 | `c4017e3419b1b68caab071328af699ecd721095ba0fa76508939d19e971d0ec3` |
| `png-pixel-review.json` | Pillow 12.3.0 解码 32 张 PNG，逐文件源 hash、RGB 极值及解码 RGB hash | `de304072681b8876c428719572782a7147aa1d7404f36ee0335064733a7ed5e2` |
| `context-scope-review.json` | 六 context 的原三候选计数、四 fixture 适用性、JVM 声明及未验证边界 | `367c5c6956e143473b08546c5348436abe269b10bdbe78b37161b73eab4a369d` |
| `source-integrity-review.json` | 三版全包前后字节清单一致性 | `da9b123bf5f898abd28e171ad62d859c3537b4946138f52ca9e119605a9a56f4` |
| `audit-json-sha256.json` | 其它审阅 JSON 的 bytes/SHA256 索引，不包含自身 | `818da69075f8ed1b10cbc20f53dba08b872481ad80c4e6d4c1bc1b77522a2994` |

| Release/context | 原子报告 bytes | 原子报告 SHA256 | inspector JSON SHA256 |
|---|---:|---|---|
| R2021a primary | 2503759 | `1bb612a76b85757fb3f2dd444f72c6beee03f4e14e71300d8aae6731ba58ffa8` | `f1464776f6fc73dbd05a4dd69ca7b11ab7cce64204eefd6205a65042d0a48c61` |
| R2021a display | 2501912 | `adc3e9da9b024c904ba801a78e582a743a9be10fc71d06efba2a3027f599077e` | `0fad1b2f583d1888bb19dfe96616f13baddfd8a0c4b000998053c69290c7cd21` |
| R2024b primary | 2482925 | `eb7ab569510ef8845202579488a9807eefa8ca9dadbe0d89268531be5adc3a1c` | `9ce84996a85970877a9373de43c58f0ea15089d5e7bf706f2ad0b743b503a7d1` |
| R2024b display | 2481528 | `6d863aa5706d6441b0a056e395235482cc20cb706e14016975d0d500c816d7d1` | `912d354ff8dc3ee6d6792586ef7e86cdd649dee61c25616f9d05d184360624aa` |
| R2026a primary | 602 | `ad099c94cc9c8137cdc90fda80355b0dd5c079161443c276f9527f88609e7171` | `950046bb3c59137c47e11cdd1b2c81cb3e46ea23b1e8e609621df831b138f915` |
| R2026a display | 602 | `fc238fabea49f72863dff53d3f59e3169bccc2934afb884123dd1986571cfd90` | `a5f800749a8adc901e719da61883bfc3c17441b65289c2a0745cc29b6d3fe080` |

## 逐 context 结果与失败阶段

缩写仅用于下列表格，四个 ID 固定对应：T=`crossed-time-depth-temperature`，P=`repeat-cast-salinity-profiles`，C=`paired-observation-model`，I=`paired-interactive`。

| Release/context | 原生子报告 | 四候选 | 原生失败阶段/错误 | CLI 退出码/状态 | 实际 restored PNG |
|---|---|---|---|---|---|
| R2021a primary | `completed_diagnostics_only` | T/P/C/I 均 `completed_diagnostic` | 无记录；候选和各 export 错误均空 | 0 / `declaration_consistent` | T/P/C/I 全白，与非纯色参考图不同 |
| R2021a display | 同上 | T/P/C/I 均完成声明 | 同上 | 0 / `declaration_consistent` | T/P/C/I 全白，与非纯色参考图不同 |
| R2024b primary | 同上 | T/P/C/I 均完成声明 | 同上 | 0 / `declaration_consistent` | T/P/C/I 全白，与非纯色参考图不同 |
| R2024b display | 同上 | T/P/C/I 均完成声明 | 同上 | 0 / `declaration_consistent` | T/P/C/I 均与各自参考图 RGB 相同 |
| R2026a primary | `not_applicable` | 0，无四候选 | 不适用，不推断执行 | 2 / `not_applicable` | 不适用 |
| R2026a display | `not_applicable` | 0，无四候选 | 不适用，不推断执行 | 2 / `not_applicable` | 不适用 |

旧版 16 个候选中，每个 `reference_png`、`reference_pdf`、`canvas_pdf`、`restored_png` 均原生声明 `api_invoked=true`、`call_succeeded=true`、`status=exported`，`error_identifier/error_message` 为空。声明 API 分别是 `print -dpng -r300`、`print -dpdf -painters`、`exportgraphics(panel, ContentType=vector)`、`print -dpng -r300`；canvas 的导出对象声明为 `matlab.ui.container.Panel`，其余为 `matlab.ui.Figure`。这些调用事实仍是原生声明；本次独立验证的是相应文件的真实 bytes/hash/header，并另外解码了 PNG。

全部候选的 `restoration_attempted/restoration_completed/root_state_preserved/parent_identity_preserved` 为 true，`callback_restoration_verified=false`；五个 `data_preservation` 阶段均为 true。没有据这些自报布尔值重新签署身份、回调或完整 native data。最终原生 [完成条件](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:182) 并不比较参考/恢复 PNG 像素。

12 张全白 PNG 的解码 RGB SHA256 均为 `b261bd33f7c6e089f7bad045fb562f71cec42fdbf370251487af995191f4b0c3`，这是 2400x1500 RGB 数据的 hash，不替代下文各文件 SHA256。其余四对参考/恢复图仅能确认解码 RGB 相同，不能由此证明 PDF 或人眼质量。

## 修复是否实际越过及几何边界

### JVM 与 root

R2021a 同包 `matlab-runtime-probe.json`、display 的 `display-rendering.json` 均声明 `jvm_available=false`；但四 fixture 在两个 context 都已写出匹配 hash 的输入声明、参考文件、canvas PDF 和恢复 PNG。本次包没有在 fixture 输入/JVM 前置条件阶段早停。具体 SHA256 fallback 后端没有逐调用日志，不能单靠此包独立认证后端调用链。R2024b 两个 runtime context 的 JVM 声明为 true，不能用它替代无 JVM 路径验证。

root inventory 在每个候选均 `captured`。两 context 的下列计数相同；`DirectChildCount` 是原生记录，不是本次独立调用 MATLAB API 验空：

| Release | Fixture | root 总数 | 排除数 | AnnotationPane 数量 | 保留 TiledChartLayout 的 DirectChildCount |
|---|---|---:|---:|---:|---:|
| R2021a | T/P/C 各自 | 13 | 12 | 2 | 2 |
| R2021a | I | 12 | 11 | 2 | 1 |
| R2024b | T/P/C 各自 | 12 | 11 | 1 | 2 |
| R2024b | I | 11 | 10 | 1 | 1 |

所有被记录的 AnnotationPane 都有 `Tag=scribeOverlay`、`HandleVisibility=off`、`DirectChildCount=0`；排除列表还包含菜单/工具栏，T/P/C 有 ContextMenu，I 没有。实际报告走到了 panel 包裹和 canvas 导出之后，未报 `RootObjects`。当前 [排除条件](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:221) 要求相应 Tag 且 `allchild` 为空，而不是以隐藏状态作为空对象证据。本包没有非空 AnnotationPane 样本，不能声称验证了该负例或独立验证其内部确实为空。

### GetProhibited 与 Unavailable

每个旧版候选有六个 original geometry 快照、两个 wrapper 快照及一份 root inventory，均声明 `captured`。六 original 阶段为 `constructed/before_wrap/after_wrap/after_pdf/after_restore/after_restored_png`；wrapper 为 `after_wrap/after_pdf`。

下表是每一阶段的对象数和 `unavailable_properties` 条目总数，不是不同属性名称数，也不是全部 getter 报错数；其中包含对象类型本身不支持的属性。两 context 相同，同组各阶段计数相同。

| Release | Fixture | Original 对象/Unavailable | Wrapper 对象/Unavailable | 每个 Original/Wrapper 阶段的 nonpublic 条目 |
|---|---|---|---|---:|
| R2021a | T | 163 / 3960 | 25 / 430 | 0 |
| R2021a | P | 164 / 4002 | 26 / 472 | 1 |
| R2021a | C | 174 / 4262 | 36 / 732 | 1 |
| R2021a | I | 160 / 3914 | 23 / 409 | 0 |
| R2024b | T | 162 / 3933 | 24 / 402 | 0 |
| R2024b | P | 163 / 3975 | 25 / 444 | 1 |
| R2024b | C | 173 / 4235 | 35 / 704 | 1 |
| R2024b | I | 159 / 3887 | 22 / 381 | 0 |

P/C 的 nonpublic 均是 `matlab.graphics.illustration.legend.Text.Position`。original 对象序号分别为 R21 P=164/C=174、R24 P=163/C=173；parent class 为 `matlab.graphics.illustration.Legend`。P 的此对象文本为空，C 的文本为 `Horizontal: observation standard uncertainty (degC)` 和 `Model uncertainty not provided`。Position 在所有八个相关快照中均是明确缺项，不可称“已取得完整图例说明几何”。[原生 getter catch](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:314) 将 GetProhibited 记录为 unavailable/nonpublic；本包证实不再因此早停，不证实该属性变成可访问。

另外独立比较了原生 JSON 中按 `object_index/class` 对齐的 `properties`：`constructed -> before_wrap`、`before_wrap -> after_restore`、`after_restore -> after_restored_png`，16 个候选均零差异。这只覆盖已经序列化的属性；不包含不可读项、真实 handle identity、回调或像素。中间 wrap 阶段不是该相等结论的比较对象。全白 restored PNG 正好说明不能将这种 JSON 相等转述为图像恢复完整。

## 输入绑定及检查强度

显式 fixture root 是 `/opt/ocean-intelligence/codex-runtime/matlab/evals/fixtures`。16 个适用候选均与对应源 fixture 的实际 SHA256 匹配；T/I 共用温度 fixture。这里的 bytes 是本次从显式 fixture root 重算，不是原生自报 bytes，原生也没有随本实验归档输入快照。不能升级成独立证明原生消费了冻结快照或数据值重建验证。

| 源 fixture | 本地实际 bytes | SHA256 |
|---|---:|---|
| `crossed_time_depth_temperature.json` | 2323 | `ca8ff03c0fc54351bcd7055546c5f2a84ccdb3b4d88882a660820ac779307a21` |
| `repeat_cast_salinity_profiles.json` | 2113 | `8c30bc832e0c958ea0795466e18a382ff6452998d57e9d4322d2775678135943` |
| `paired_observation_model.json` | 2771 | `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b` |

64 个实际输出 bytes/SHA256 全部匹配原声明。全部 32 张 PNG 的前 33 bytes 都是 `89504e470d0a1a0a0000000d4948445200000960000005dc080200000029872243`，PNG signature/IHDR/CRC 有效，宽高为 2400x1500、8-bit RGB，并均经 Pillow 成功解码。独立像素检查是发现空白用的确定性检查，不是人工视觉签字。

全部 32 个 PDF 的前 8 bytes 都是 `255044462d312e34`，即 `%PDF-1.4`。本次未运行 PDF 页面、字体、文本完整性工具或 PDF 渲染检查；不能从 signature、文件非空、`exported`、目标 `[576,360]` 或 PNG 尺寸推断 PDF 的 actual MediaBox、exact page、字体嵌入、文字未裁切或内容齐全。

## 64 个实际产物清单

以下 bytes/hash 均来自本轮实际文件重新读取，不只是复述 JSON。路径为 `<完整 fixture ID>/<文件名>`，上下文根目录见前文；四种调用状态均已在逐 context 部分逐项限定。

### R2021a primary

| Fixture | 文件 | Bytes | SHA256 |
|---|---|---:|---|
| T | reference.png | 93983 | `ac52ad6e87e0fe11bad31592bcfc0972f5459d95192390b562fe287a31d11ac8` |
| T | reference.pdf | 54116 | `e5ae9cebcc646590f009386c3df303007404eba58709dfee7983e3249b547d68` |
| T | canvas.pdf | 60191 | `5f48a4dbbfe42a1cc8dd8e3104e229d8d516ffb97346df344b3bd0a5826f5ec7` |
| T | restored.png | 14021 | `9d63d82953c4e9333d7743c3f4a10780797bdc9778efebbcd715b9cd5bb823f3` |
| P | reference.png | 136472 | `7835b00f564dc40b8e741579aff1f8fa3853dde3a17fe8db7ac244809c40d5f1` |
| P | reference.pdf | 3481 | `1aa001906ebdb53ee170b882137e597ce01da75f6f38ceb40fd02b79f686c622` |
| P | canvas.pdf | 9352 | `4a7e49e2e6752cfeb875a33346ce31e9f1f996e539eaa994e38a734a3fd8e22f` |
| P | restored.png | 14021 | `e79ff70128509dfa465c955ba3d4274a04b9216325aaab0746bff52b448e8d11` |
| C | reference.png | 133047 | `9fa5b4cf0c960428f2757a31ec6929c32d676d149a70d3f6480130a021723f14` |
| C | reference.pdf | 4069 | `fb7a03b2a3721a987e664b259575cebbd603034bb4769efed5480cbd3f7cbf76` |
| C | canvas.pdf | 11064 | `77f7a9e2e4db6071adf610ac2dbd50a59d5a36a57ae062bccd3b8350bc940d1a` |
| C | restored.png | 14021 | `d3ecab2e865bb05cf2287e9e1ffb933a9522136c56dfb8026c09e574b78070ec` |
| I | reference.png | 85212 | `ec9d758092e0c19328351fce9ed64208cfc7d4dca2789df00d36641a4c0c6d7a` |
| I | reference.pdf | 13395 | `64f01dcd9b1dcdb71b840fda8da2bf0b833b79bb9b68282852f221f71865eac2` |
| I | canvas.pdf | 9434 | `c2b633d4775c1cfa67e0bc62f816468c2523c0971ca3e411eeeabb3f943a0cf0` |
| I | restored.png | 14021 | `e4e355f6f538fa0514944289253d2d00f6c4d12f9d94c8c8a26caa2c5ff5e15a` |

### R2021a display

| Fixture | 文件 | Bytes | SHA256 |
|---|---|---:|---|
| T | reference.png | 103996 | `cba61cc0ce198bb27cf5eb83c04746fc757544f92d3f7857e41ff9b9f516d749` |
| T | reference.pdf | 55324 | `984fb5619822e5d7fa23b83be011b84354d2bc88d789079dde9b0b19ffc143fb` |
| T | canvas.pdf | 61432 | `748205d9915d009c4380c5faeca6ad37ad08fd983c7eda5a8b3a80f364463d11` |
| T | restored.png | 14021 | `ea893dd69e74dfe2c81f9bc405e566fa657837e71f78fe45ebb71a652842efc4` |
| P | reference.png | 139571 | `600910136680317f7e95c5e68e6a1b538336ba984f9b633af3f25b164546473f` |
| P | reference.pdf | 3522 | `cf3457fce2bee26db1f49860311c97bf84226d936cd0e13cdfc329ca5693395e` |
| P | canvas.pdf | 9396 | `6b5340f6f44749c5e242ae7d0d6a703163ce25bda0bc530e951599227cc4504e` |
| P | restored.png | 14021 | `6b227720348cf0634c621a9f7f9a3cf13536b0798fb64748cd1c2398cb7d7094` |
| C | reference.png | 134055 | `825bb10103b96f3f8b5b911509e02878cce34f88e951cc42de9e3e8e2622a86b` |
| C | reference.pdf | 4088 | `1c7df6058319ab15a217458e54607aaf18b99af6c73b82afff31a5aeaf8630b3` |
| C | canvas.pdf | 11096 | `c4036a4174674747b40ebfcf7db4d5d67d4e580f3b960dad77782044e15d8b8e` |
| C | restored.png | 14021 | `99d16b3b0be3e066ebd0ecf60cc87469bcdc854a7f51aa952d139034ec5cc0a4` |
| I | reference.png | 85388 | `4d8fd46460b8f4bcde6944321f38dc1b1562d7d5316adcea57e3242d5a8c16c9` |
| I | reference.pdf | 13840 | `bb75339dffa22de3b7e3149e591ca2cbabea8be482633aebe571727015ba4014` |
| I | canvas.pdf | 9494 | `eb843f10a14182ce67199cb87c38aa864c30738a452b2ffcdea068472e2e82a6` |
| I | restored.png | 14021 | `a3e7922f1e546507a7e4d9099ce37af615218768417221a5e0169cecef223573` |

### R2024b primary

| Fixture | 文件 | Bytes | SHA256 |
|---|---|---:|---|
| T | reference.png | 104061 | `4cda8ff29249aa8c599093e4e29df2f75ff5e939dc204732ebb5c66e5598fea7` |
| T | reference.pdf | 54765 | `4360bf40bb9061cd19f9b0be65af422bd1668d111605bec2d058c28bf6f61f2b` |
| T | canvas.pdf | 60871 | `d57ceb48ee3c8bcc9a2f4af1b65ff923754c993685a33dc99d26d00e270f1eb6` |
| T | restored.png | 14021 | `30d4464bafa18c97021364f77751ae6e954af742327aade6e3889207aa4a3b41` |
| P | reference.png | 136638 | `0910e0b19987714a8fbab982c30909b9d1185137be35a1926f36eaeb20e9a2ef` |
| P | reference.pdf | 3445 | `f840fa6e94bac3840af1b9ea36572b65954d47e5e21f30ef8565de4daf2373f4` |
| P | canvas.pdf | 9313 | `4ed91bdf0b49968a91d99b76f69b4c1e17bad7d3b1844dded78f59d1de3594f0` |
| P | restored.png | 14021 | `fb82e4bb4a2b0d0bd0504b4e5d97a588f226c0097867527133da62ebd352d455` |
| C | reference.png | 137613 | `44b13c972a822c9851012731520b4cf187cfa10ed3cbd5fac87e8833c40f750a` |
| C | reference.pdf | 4052 | `d153a1e115a8da0e607ea1348d58ae1b02f446adaeeb81eb17d92b346ef9e221` |
| C | canvas.pdf | 11040 | `684ea381bc8ee40a5cf966b3cd04b9d9a0ce5359cf7537dae49bac9a0dc3232c` |
| C | restored.png | 14021 | `f522fcf67e2fe607da369a4071fafe7dfdcfce17d0bf218e4358f2250b1a27aa` |
| I | reference.png | 85212 | `12b229ee6d721fca366b0604afe252230e69446d1068f00a9688c2746c41e4e6` |
| I | reference.pdf | 13395 | `29a63e66534b84384dbb4aedda57305f22335885ac00e2b794f526d779caf47e` |
| I | canvas.pdf | 9434 | `2bbeb998ff5cb5c9e5cd295c59aeba13e86e96285ba1db745d7ebb1bec57b450` |
| I | restored.png | 14021 | `ccc9aad4fb5754e8d082d6e9e40ff2a3c945b5ecd8b3510135171d424750e88d` |

### R2024b display

| Fixture | 文件 | Bytes | SHA256 |
|---|---|---:|---|
| T | reference.png | 98675 | `721afd4dfd066af9b4d7e4a66fa76c62d2022b91ac1cd3980016532891ed626e` |
| T | reference.pdf | 55324 | `2e0bb116df29202a171de448e2a6a515fdf4c4198b0482dde2e881296d0c6049` |
| T | canvas.pdf | 61432 | `91599d8e9fd154b939b9c5c092f1551679d1a9db26cbcb953ac1baa4beffc19c` |
| T | restored.png | 98675 | `333f4e7e1a5f3447cdcde45ddf8d7d36c1d9869ee8d754bb14c17d1ea78b2e82` |
| P | reference.png | 116421 | `9fc8a0f2581872e522b203f5a3f4b11e8956d0be3b728cefc1c96e29dc7491c5` |
| P | reference.pdf | 3503 | `b59698df3bf3817e0502dfd8839a4beb2cbbe48b46b7e00259d273b0863f776c` |
| P | canvas.pdf | 9379 | `c077e47c62b2c9b3b9aa6b2161f45447d341b2da6791f0c949b2cc1a373bdea6` |
| P | restored.png | 116421 | `02f8fecd59aece528d9d3c232e35dd377a72dfb156ab5302329b3fa1b443224e` |
| C | reference.png | 126227 | `fcc56cc3f706d34b3477e901745e648a932886aa5fe4267adf7d731d0cf9b0a5` |
| C | reference.pdf | 4055 | `26288cc5e599773ab1acf87c6239161f80d8db739e46cc2d3ee1c3f5d0b5a0a9` |
| C | canvas.pdf | 11059 | `823d8e7beaafb96d263ce59600e8e02ca725982f978c8ed2e27b33b8f09605b8` |
| C | restored.png | 126227 | `c4e59b02d008861216e17a5ee21092e68fab88884eb02aa1a46b1ceaa3e49eff` |
| I | reference.png | 66115 | `4acdf68cf89e1c18c372451c066a6317c64638a885c966f786ec79472c27602f` |
| I | reference.pdf | 13840 | `6b97fe665d9fa8e51a06dbc4d6726c3ad2b5dd3c134ad101160c1c2e789c49b5` |
| I | canvas.pdf | 9494 | `bdcdaf0efe5bad3f92db19c34db7b75379dc10b66ef9ec859d47621d9f1a3e4b` |
| I | restored.png | 66115 | `30c2a043cc98ec90294309041c0502fe752a2534b5ee64c363c24a3334164c35` |

## 原三候选与其它流程隔离

三版的 primary/display 原 `native-pdf-page-probe.json` 都仍是 `candidate_count=3`、`exports_succeeded=3`、`exports_failed=0`、`exports_skipped=0`、`status=completed_export_checks_only`、`stage_status_scope=original_three_candidates_export_checks_only`，并只保存 `fixture_canvas_report=native-fixture-canvas/native-fixture-canvas.json` 指针。上述数字不包括新四 fixture，也不能掩盖本轮发现的 12 张空白恢复图。

R2024b 的整个 DISPLAY 原报告仍为 `completed_with_failures`、`failed_count=1`，失败项是 publication，原始标识 `oi_annotate_svg:UnsupportedNormalization`，原始信息 `SVG viewport normalization does not support element font`。这是 DISPLAY 包的另一项失败，不应被本子实验声明完成或四对 RGB 相等覆盖；本轮未定位或修改该故障。R21/R26 的 DISPLAY 根状态是 `completed_pending_external_review`，也不是视觉通过。

六次 inspector 输出均保持 `counts_toward_stage=false`，`pdf_pages/pdf_fonts/visual/matlab_execution=not_verified`。没有新增 stage、修改分母/分数、生成 desktop/CJK true，或称本次为真实海区报告。

## 原包前后完整性

每版在语义审阅前记录整个目录所有普通文件的相对路径、bytes、SHA256；完成后重新读取复算，三版均无新增/缺失/字节变化。没有遇到 symlink 或其它非普通文件。清单 hash 定义为对 `files` 映射的 `json.dumps(files, sort_keys=True, separators=(",", ":"))` UTF-8 bytes 求 SHA256；不声称读取不会改变文件系统 atime。

| Release | 普通文件数 | 总 bytes | 审阅前 inventory SHA256 | 审阅后 inventory SHA256 |
|---|---:|---:|---|---|
| R2021a | 376 | 24354333 | `22493a45ec86edbdcf04c3f04d520f871751fb52bde18c25a77d90c5dcce95c0` | `22493a45ec86edbdcf04c3f04d520f871751fb52bde18c25a77d90c5dcce95c0` |
| R2024b | 364 | 24233973 | `3bbf4ee0ae82421c34cf3a44206b4569f50b97db342eb90572a4cf6ed80f760c` | `3bbf4ee0ae82421c34cf3a44206b4569f50b97db342eb90572a4cf6ed80f760c` |
| R2026a | 359 | 12066299 | `da920187aad758172d9170ced48c0e7fd677ad24c1bab92b43296ae653dc26d4` | `da920187aad758172d9170ced48c0e7fd677ad24c1bab92b43296ae653dc26d4` |

完整清单是独立审阅目录的 `R2021a-before.json/R2021a-after.json`、`R2024b-before.json/R2024b-after.json`、`R2026a-before.json/R2026a-after.json`，`changed_files` 均为空。本轮只新增本 Markdown；其余写出均限独立 `/tmp` 审阅目录，无 MATLAB 执行、代码/测试/冻结文件变更或提交。
