# 第二十四批：第二十三批实际运行与图件审阅

日期：2026-09-06。原始 CI 为 [34004200751](https://github.com/wzn1118/ocean-intelligence/actions/runs/34004200751)，远端提交 `9593a0cd9ec44971cb4c3df7fa7aa77c01209949`，本地提交 `3fdbdf559f396a5f07056304fa67f46755b007e2`。GitHub API 已确认 completed/failure；本机下载路径为 `/tmp/matlab-run-34004200751`，没有改动历史产物。

## 已证结果

| 范围 | R2021a | R2024b | R2026a |
| --- | --- | --- | --- |
| 主 MATLAB 阶段 | 20/20 | 20/20 | 20/20 |
| 原始 evaluator | 90/runtime_pending | 90/runtime_pending | 90/runtime_pending |
| 修订 Astra source 原生调用、完整 v3 导出前后核对、三格式 manifest | passed | passed | passed |
| 模型图独立物理审核 | 2/3 | 2/3 | 3/3 |
| 总体 CI | failed | failed | failed |

修订源码 SHA-256 为 `3faec2ab0fd5d7a2e5fcf43a211f3848f399e6a28eae2618566ba3ec6f4021f0`。原模型的 listfonts 额外断言由模型自己改用现有 `oi_font_available`，两旧版构图失败已在本次真实运行消除。不能把主阶段 60/60 写成全量 100 分。

Faraday 实际查看三份 PNG、三份 PDF 渲染，三份 SVG 仅做物理/结构检查。旧版 PDF 仍仅含未嵌入 Courier，图例标题越框、虚线样例压字；R2026a 统计贴近顶刻度，参考线仍穿点。三图没有中文文本，不能据此批准 CJK。19 个审阅对象 hash 未变。详见本机 `/tmp/matlab-round24-astra-render-faraday/astra-quality-review-round24.md`；既有 R2021a 外检没有被覆盖。

## 局部布局证据

Huygens 审核三版 primary/DISPLAY 的比较图图例 A/B，独立核对 36 份完整 v3、24 件图件及 119 个读取对象 hash。仅 R2021a 的 `axes-outside` 候选明确消除 xlabel 遮挡；R2024b/R2026a 基线无此遮挡，候选却缩小轴宽。因此本批只在固定比较 fixture 的 R2021a 调用处保留 axes 外置图例，不改其他版本、默认 builder 或科学数据。

此候选不解决旧版 PDF 字体、主标题裁切或图例越框。A/B 使用直接 print，不能冒充生产 exporter/SVG 全链验证；正式调用处变更仍待下一次 MATLAB CI。完整本机审阅在 `/tmp/matlab-round24-legend-ab-huygens/legend-ab-review-34004200751.zh.md`。

## 回归元数据修复

三版 regression 原件都把六个一维 `scientific_data_contract.shape` 写成 JSON 标量，导致 `dimensions.shape` 失败；二维四图保持数组。生产端在计数核对后将 shape 转成 cell 数组，原生断言检查 JSON 数组及数值往返，消费者继续拒绝标量，未放宽门槛。

`baseline_not_found`、缺少受信视觉证据、出版颜色/字体证据及旧版字体失败仍如实保留。源码更改和本地测试不等于已消除所有 CI 失败，也不认证真实海区、交互或完整报告。
