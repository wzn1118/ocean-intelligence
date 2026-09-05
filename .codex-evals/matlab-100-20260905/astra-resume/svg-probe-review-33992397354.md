# SVG Probe Review: 33992397354

2026-09-05。只读检查 R2021a/R2024b：primary 12 份、DISPLAY 12 份原生 SVG；另核对四份诊断 JSON 与主协调当前 schema 补丁。

## 修复完整性

未发现本次结构数组修复遗漏。原 `xml_read` 是整个 DOM 证据提取阶段的名称，不等于 XML 语法错误；本批 24 个错误均为 `MATLAB:heterogeneousStrucAssignment`，而 24 份原件经 ElementTree 均成功解析。

| 数组 | 空数组字段顺序 | 追加值来源 | 复核 |
| --- | --- | --- | --- |
| `rectangles` | `node_name, attributes, ancestors_nearest_first` | `element_record` | 一致 |
| `clip_paths` | `element, descendants` | `clip` | 一致 |
| `descendants` | `node_name, attributes, ancestors_nearest_first` | `element_record` | 一致 |
| `ancestors_nearest_first` | `node_name, attributes` | 父元素记录 | 一致 |

[修复位置](/opt/ocean-intelligence/codex-runtime/matlab/tests/diagnose_svg_print_sizes.m:225)覆盖全部四处结构数组追加；`attribute_records`、`errors` 原本已有字段 schema。其余 `struct()` 用于整字段替换，不是对无字段数组追加异构元素，不属于同一问题。
所读修复后源码 SHA-256：`ef9989bfb181e7883ca80523ed8cf2de77d2770a3b80b245a514c9aa50e4cc4f`。复跑 `mh_lint --matlab 2021a --ignore-config --brief` 通过；本机无 MATLAB，不能宣称修复后的 DOM 提取已实跑通过。

## 原生结果

四组 JSON 的 24 次真实调用均成功：默认为 `print -dsvg -painters`，显式组仅追加 `-r150` 或 `-r300`。每份原件实测 bytes/SHA-256 均匹配 JSON 的 `bytes`、`sha256`、`sha256_after_xml`，且原记录 `native_file_unchanged_after_xml=true`。
12 组 default/explicit 配对全部逐字节相同，XML canonicalization 比较也全部相同。因此在这两版、两种 DISPLAY 环境、三组纯折线样例上，显式 `-r{dpi}` 未改变输出，不只是未修正尺寸；不将此推广到含栅格图像的所有 SVG。
**全部 24 份原件均无 `viewBox`，也无显式 `preserveAspectRatio`。下表是原始无单位 width/height，不是 viewBox，也不倒推为英寸或目标像素。** 每份的两块背景 rect 和矩形 clipPath 路径均使用同一实际宽高。

路径基准 `/tmp/matlab-run-33992397354/matlab-full100-<release>/`；P=`export/svg-print-sizes-probe/`，D=`display-comparison/svg-print-sizes-probe/`。每行绑定 `<case>-default.native.svg` 与 `<case>-explicit-resolution.native.svg`；合并两版的 P 行各绑定四份文件。

| release / 模式 / case | PPI | raw width×height | bytes/文件 | SHA-256（同组两参数路径相同） |
| --- | ---: | --- | ---: | --- |
| R21、R24 P / `400x300-150dpi` | 72 | 192×144 | 22435 | `3ee123212795ace5484a05d5d9ce19e16685f6d2aeac7fe6d6ce515a105579e2` |
| R21、R24 P / `997x613-300dpi` | 72 | 239×147 | 25475 | `a8e109459cdc99a77e0406bd3efcc4497116af644946b1f782edac1136ac3a00` |
| R21、R24 P / `1200x675-300dpi` | 72 | 288×162 | 25424 | `ca2bf0481959cf95b996cc0d8f28b30d7265233751355c923afb8fe4bac34687` |
| R21 D / `400x300-150dpi` | 100 | 267×200 | 22756 | `b4695f72e55a6082c5433c6544d9adef5279e8293dd3497fa9a127c80bf68a12` |
| R21 D / `997x613-300dpi` | 100 | 332×204 | 25784 | `4e2dad6d23c9f46ee9ce55aac6482b08f81f6c13dbc974f271cbb2fbbb1ae0fa` |
| R21 D / `1200x675-300dpi` | 100 | 400×225 | 25809 | `f535454c12fdcd67ed63e9a4e2cbcb32579f0b1a055b7b8317b6f1eabf0ce1ef` |
| R24 D / `400x300-150dpi` | 100 | 267×200 | 21024 | `7d8df73bfb3d4cbe203b7035524656791cb3368b403dcb4841413f1a788523a5` |
| R24 D / `997x613-300dpi` | 100 | 332×204 | 23019 | `4f91ed1e8e9fb76298d992e101857662d4ab90c21e7d4b7c6f2e5bdd74893cb5` |
| R24 D / `1200x675-300dpi` | 100 | 400×225 | 23044 | `da6c4a1985373b3559cea6e771fa1b181bcb0f0373a60ae8893d409cd9e15e73` |

四份 `svg-print-sizes.json` 的 SHA-256：
- R21 P：`f3aa7f6a5471e1e4f6bd3010a7634326f4d41307ae1d0970f3fe07038ee6d218`；R21 D：`38942fd4541a51a10728f519f5bde87dc15f9a2a0f6e451cc8493eadb6a7ad77`。
- R24 P：`c98bf35b68afb625c15a296217d78c0df5abb836fbc94cba5f5dccbf381b12b9`；R24 D：`20150239574c4b11c180f689f1b5ff5b91b549278794534c549b464e20ddc74a`。
P 的 DISPLAY 为空，D 为 `:98`；四组所选字体均为已确认可用的 WenQuanYi Zen Hei。两版 primary 的 `export-runtime` 均因 `diagnose_svg_print_sizes:IncompleteDiagnostic` 停止，publication.svg 均不存在，不能拿本轮为后续 publication 背书。

## 结论与边界

schema 修复针对诊断记录拼装，静态复核完整；它不改变 native SVG，也不解决屏幕坐标整数化或严格尺寸比例问题。`-r{dpi}` 对本批对照无效，不能作为已证实的尺寸修复。
没有给缺失 viewBox 填目标值，没有归一化、修改原件/门禁/生产文件或回写通过标志。后续应真实重跑修复后的诊断，确认 rect/clip/ancestor 证据完整且哈希不变；SVG 精确尺寸和视觉仍须独立验证。
本轮只创建本报告，完成的是结构 XML/JSON 读取、24 份文件完整性检查和代码静态复核；未提交或推送。
