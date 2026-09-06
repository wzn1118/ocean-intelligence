# MATLAB 三版本 CI 失败修复

## 原始失败

用户指出 `MATLAB R2021a runtime`、`MATLAB R2024b runtime`、`MATLAB R2026a runtime` 为 failure。归档 run34007639973 的三版各完成 21/21 MATLAB 主阶段，但后置 `regression-contract` 均失败；两旧版另有 `rendered-artifacts` 失败。随后 run34008602484 也以 failure 结束，不能将原生阶段通过解释为整体 CI 通过。

回归检查将原本留待审阅的 `visual_inspection.required`、未提供图像基线、glyph/完整色觉/未测图例标题认证混入自动运行门禁。与此同时，旧版 `print -dpdf -painters` 实际把所选 WenQuanYi 字体替换成了未嵌入 Courier；这是导出缺陷，不能改成 pending 绕过。

## 原生 PDF 修复证据

- 字体对照请求 `fe9ccc40-f210-4887-bae1-b55e208fde2c`，run34009225397，在输出第一组对照后因诊断脚本的空 struct 赋值错误失败；保留失败回执。原件仍证明 print 的 Courier 未嵌入，而同图 exportgraphics 的 WenQuanYi 已嵌入。该失败不计为成功执行。
- 四 fixture 对照代码 SHA-256：`4e6e900cce4713d0e580bb39c3107ac83f4ebef66d88cdd2eb8b74d23c48f53c`。
- R2021a 请求 `7d9e7e95-da95-4f38-ab53-f7b676b10a93`，[run34009326468](https://github.com/wzn1118/ocean-intelligence/actions/runs/34009326468)，MCP 返回 `native_verified=true`。
- R2024b 请求 `8f68d785-6170-40fc-a9dc-3ea198b396a5`，[run34009328773](https://github.com/wzn1118/ocean-intelligence/actions/runs/34009328773)，MCP 返回 `native_verified=true`。
- 两版共八份 PDF 经 Poppler 检查均为 576x360 pt、单页，WenQuanYi CID TrueType 字体全部嵌入并带 Unicode 映射。
- Pillow 对八组导出前后 PNG 完整 RGB 比较全部相等，均为 1200x750 且非空。原 children 顺序断言全部通过。
- 原件目录：`/root/.cache/ocean-matlab-mcp/downloads/5d66a686-dd6a-4ce5-8736-c169616fc40f/files` 和 `/root/.cache/ocean-matlab-mcp/downloads/3bf0a21e-a1bb-442b-bc97-48fb006c5748/files`。
- 实际打开八份 PDF 的渲染联系图 `/tmp/matlab-failure-pdf-previews/comparison-sheet.png`。字体及图形非空，但对照 helper 的旧 R2021a outer-tile 比较图仍有图例标题挨近横轴标签，故不签整体视觉批准。生产 evaluator 既有的布局修复不改写此诊断默认值。
- 额外 R2024b SVG 状态对照请求 `14a962ea-05dd-41a9-95fe-24c1619871b3`，run34009943971，原件 `/root/.cache/ocean-matlab-mcp/downloads/945ebbf7-c690-4a98-a9fe-7e3a1e7305ce/files`。四组 SVG 经 XML 解析后内容完全相等，四组 PNG 像素相等；DISPLAY 环境三图原本已有 SVG font 元素，前后数量相同，不将这组原 SVG 批准为归一化白名单合格。

正式修复在 `oi_export_figure` 对 R2020a-R2024b 选择同图 `exportgraphics`：添加最底层白色画布 axes，导出后仅删除临时 axes；不移动、复制或缩放原绘图对象，不改写 PDF 字节，不使用 Ghostscript 或栅格化替代矢量。R2025a+ 保持原生精确尺寸接口；R2019b 保留原 print 路径，R2020a API 路径尚无实跑证据。正式测试增加原 children/current axes/临时画布清理和导出前后像素比较。

## 自动门禁范围

完整回归默认行为保持不变。CI 显式使用 `runtime-artifacts` 模式，保留全回归失败/未验证字段，并额外报告自动运行结果及视觉、图像基线、出版审阅待完成事项。显式错误声明、损坏文件、哈希和尺寸错误、科学与交互契约违规、实际布局和色彩审计失败仍必须失败。

旧版 PDF 字体缺陷通过导出代码修复，不能通过关闭检查解决。除 evaluator 四图外，CI 新增回归十图 PNG/PDF/SVG 的独立产物检查，严格验证全部三十件产物。自动检查通过不代表评分 100、完整视觉审阅、桌面交互或真实海区报告认证。

## 方向图修复

全回归外检发现 R2026a 方向玫瑰图的零半径网格导致 PDF `No current point in closepath`，且原方向说明只有元数据、没有真实显示。修复每次绘图先恢复自动径向刻度，再仅去掉退化零刻度；RLim 仍从零开始，原 Histogram、零值 bins、权重、缺测和方向约定均保留。完整方向说明加入原生双行标题。三种导出用例与同 PolarAxes 小、大、小跨度复用用例接入原 publication 阶段，不改变 21 个主阶段的计数。

最终 R2026a [run34010279036](https://github.com/wzn1118/ocean-intelligence/actions/runs/34010279036) 成功，候选源码 SHA-256 `b4eb0869a02791ed322baf15e74413e32f5b627e9ad226b47106d77a5fd10880` 与本地一致；三份 PDF 字体嵌入、完整说明提取及零 stderr 检查通过，渲染与上一轮已目视检查图件相同。原件 `/root/.cache/ocean-matlab-mcp/downloads/f34a0013-f02c-45af-8738-2fbfd251b472/files`。没有用抑制警告或修改 PDF 字节清除错误。

## 集成状态

两旧版针对性原生对照通过；正式修复的三版本完整 CI 尚待本轮提交后的结果。历史 failure、原回执、源数据和既有评分不改写。

本地验证：354 项评测测试通过，完整 Node 扫描 1270 通过、1 跳过、0 失败；回归检查器定向 147/147、shell 定向 30/30 通过，四份修改的 MATLAB 源码通过 R2021a 语法检查，工作流通过 actionlint，资产检查与技能校验通过。

首次静态总评拒绝了新增 `test_stage_status.py` 测试后的旧冻结哈希。按仓库提供的 `evaluate.py --write-freeze` 更新清单，再执行 `--verify-freeze`；仅该测试文件的一行哈希改变，33 个清单文件的路径集合不变，未修改 fixture、rubric、评分器或历史运行产物。清单更新不是静态总评或原生运行通过，完整重跑另行记录。
