# Argo 4903822：三次离散剖面的最小报告 component

报告 ID：`astra-argo-round24`。状态：**pending；complete=false**。数据身份：历史回放归档；上游真实性未核验。

本 component 仅描述南大西洋局部分析框内的 Argo 4903822 历史回放归档。1 个平台、3 次离散剖面，共 1785 层，温度为 -0.326 至 2.129 degree_Celsius。原生图件与服务绑定尚未产生，complete=false。

## 范围与样本

- [R1–R3] 原文件顺序为 067/066/065；层数 595+596+594=1785，独立平台数为 1，剖面数为 3。
- 声明时间范围：2026-08-07T14:51:30.000Z 至 2026-08-27T04:54:30.000Z（UTC）；端点间隔 19.585417 天，仅 3 个时间点，不是连续 20 天序列，也不能因文件名 30d 推断满 30 天覆盖。
- 局部分析框为经度 −13 至 −12 度、纬度 −55 至 −54.5 度（带符号十进制度）。实际点位包络：经度 -12.79532 至 -12.260258333333333 度、纬度 -54.85381 至 -54.64378 度。这里只包含 3 个位置，没有九区覆盖审计或海区外推。
- 1785 层的三变量均有限，缺测层 0；pressure/temperature/salinity 三套 QC 各有 1785 个 flag=1。按本地“全部 flag=1”规则纳入 1785 层；flag=1 采用 Argo good 解释，但文件未附 flag 字典，也未独立重做 QC。
- pressure、salinity、temperature 的 data_keys_mode 均为 A；profile_direction=A 是另一原字段，分别保留，不混为同一含义。不确定度：not_provided。

## 可复核范围

下表全部为档案声明的历史剖面记录；范围为直接读取原值后的本地派生统计（E3），不把本轮来源核验描述为 E1/E2 已通过。

| 证据/剖面 | 时间 UTC | 经度、纬度（度） | 层数 | temperature（degree_Celsius） | salinity（psu） | pressure（decibar） |
|---|---|---|---:|---|---|---|
| [R1] 4903822_067 | 2026-08-27T04:54:30.000Z | -12.79532, -54.679433333333336 | 595 | -0.326 至 2.125 | 33.826 至 34.726002 | 3.1 至 1997.900024 |
| [R2] 4903822_066 | 2026-08-17T09:52:30.000Z | -12.436848333333334, -54.64378 | 596 | -0.136 至 2.129 | 33.879002 至 34.726002 | 3 至 1997.800049 |
| [R3] 4903822_065 | 2026-08-07T14:51:30.000Z | -12.260258333333333, -54.85381 | 594 | 0.003 至 2.094 | 33.868999 至 34.723999 | 2.9 至 1995.699951 |

全记录范围：[R1–R3] temperature -0.326 至 2.129 degree_Celsius；salinity 33.826 至 34.726002 psu；pressure 2.9 至 1997.900024 decibar。原层等权均值依次为 1.281584874 degree_Celsius、34.465375388 psu、739.702520698 decibar，仅作算术复核。原采样间隔随压力而变，不能据此比较海区平均状态或推断时间趋势。

## 原始来源声明

以下逐字保留 source 字符串的值，JSON 仅调整展示缩进；完整原文在函数返回的 RawJSONText 中保留。来源 URL 仅作档案引用，本轮没有访问。

### [R1] 4903822_067

```json
[
  {
    "source": [
      "argo_core"
    ],
    "url": "ftp://ftp.ifremer.fr/ifremer/argo/dac/coriolis/4903822/profiles/R4903822_067.nc",
    "date_updated": "2026-08-27T05:30:25.000Z"
  }
]
```

原 vertical_sampling_scheme：

> Primary sampling: averaged [10 sec sampling, 5 dbar average from 1980 dbar to 500 dbar; 10 sec sampling, 2 dbar average from 500 dbar to 100 dbar; 10 sec sampling, 1 dbar average from 100 dbar to 2.2 dbar]

原 date_updated_argovis：`2026-08-27T08:47:42.530Z`，不是本轮抓取时间。

### [R2] 4903822_066

```json
[
  {
    "source": [
      "argo_core"
    ],
    "url": "ftp://ftp.ifremer.fr/ifremer/argo/dac/coriolis/4903822/profiles/R4903822_066.nc",
    "date_updated": "2026-08-17T10:34:08.000Z"
  }
]
```

原 vertical_sampling_scheme：

> Primary sampling: averaged [10 sec sampling, 5 dbar average from 1980 dbar to 500 dbar; 10 sec sampling, 2 dbar average from 500 dbar to 100 dbar; 10 sec sampling, 1 dbar average from 100 dbar to 2.2 dbar]

原 date_updated_argovis：`2026-08-18T07:36:32.489Z`，不是本轮抓取时间。

### [R3] 4903822_065

```json
[
  {
    "source": [
      "argo_core"
    ],
    "url": "ftp://ftp.ifremer.fr/ifremer/argo/dac/coriolis/4903822/profiles/R4903822_065.nc",
    "date_updated": "2026-08-07T15:30:41.000Z"
  }
]
```

原 vertical_sampling_scheme：

> Primary sampling: averaged [10 sec sampling, 5 dbar average from 1980 dbar to 500 dbar; 10 sec sampling, 2 dbar average from 500 dbar to 100 dbar; 10 sec sampling, 1 dbar average from 100 dbar to 2.0 dbar]

原 date_updated_argovis：`2026-08-08T08:17:44.340Z`，不是本轮抓取时间。

## 方法与函数接口

按原 JSON 的 data_info[0] 确认变量顺序，按 data_info[2] 核对单位和 A mode；逐项读取 data[变量索引][原始层索引]。原始维度是 6×595、6×596、6×594（变量×层）。不排序、不平滑、不插值、不换算、不生成密度线。完整层的三套 QC 必须均为 1。层均值为 sum(x)/N，仅用于复核，不是压力加权、体积加权或时间平均。

最小原生图计划调用 oi_plot_ts_diagram：横轴 Salinity (psu)，纵轴 Temperature (degree_Celsius)，色条 Pressure (decibar)。067/066/065 分别为圆、方、三角，图例顺序同原文件。构图前设置 8×5 inches，预留底部图例和右侧色条空间。pressure 不转换为 depth 或 m。未提供不确定度，返回 not_provided；不向 helper 传入 U、不补零。

astra_argo_trial.m 的首个函数为 [figureHandle,result] = astra_argo_trial(inputPath)。函数只读取传入原文件，返回 helper 实际使用的原生 figure，成功返回时不关闭、不导出。result.RawRecords 是单一完整逐层记录表；SourceDeclarations 保留各 profile.source 的全部原始结构及字符串，RawJSONText 保留完整原始文本；OriginalDataInfo、OriginalData 保留原始数组。HelperResult 保存 helper 返回结构，GraphicsRecordMap 及 Scatter.UserData 关联 RawRecords 行、ObservationID、SourceRow、SourceFileRow。层 ID 是本地派生，不是上游提供的观测 ID。DisplayPermutation 为原序 1…1785。

helper 的显式 TemperatureType 单位白名单不接受 degree_Celsius；本函数保留原单位并使用 unspecified，不擅自改成 degC。原档案也未显式给出温度/盐度热力学类型和压力基准。R2021a helper 的原生 DataTip 分支仅显示 X/Y；完整逐点字段仍保存在返回映射及离线 HTML。后者是浏览器辅助视图，不是 MATLAB 导出或原生数组证明。

字体沿用 oi_ocean_theme，以 oi_font_available 精确匹配；CJK 首选候选是 WenQuanYi Zen Hei，实际选中字体留待 MATLAB 运行记录，存在性不等于字形或嵌字通过。色彩是本地 256 级连续 RGB 查找表，端点 [0.05,0.20,0.28] 与 [0.78,0.88,0.62]；只插值颜色表，不插值科学数据。图形对比度、灰度、色觉、留白和裁切均待核验。

离线辅助视图见 [逐点 T-S HTML](astra-argo-round24-points.html)，包含全部 1785 条记录的 hover/focus 提示和稳定 ID；它与 MATLAB 函数消费同一哈希快照、原单位、QC 与剖面编码。浏览器实际交互和视觉验收仍 pending。

复算脚本：`node astra-argo-round24-build.mjs <原始JSON路径>`，在脚本所在授权 generated 目录创建文档，已存在目标文件时拒绝覆盖。本函数的未来调用为 `[figureHandle,result] = astra_argo_trial(inputPath);`；调用方先 addpath 仓库 assets 和源码目录，再决定导出与关闭。本轮实际只执行 Node.js 复算，不执行上述 MATLAB 调用。

## 限制与待完成项

文件是现存 Argovis/Argo 响应形状的历史回放归档，不是本轮合成数据；哈希一致只证明读入了指定字节，不证明上游真实性。source、date_updated 和 data_info 是档案声明，本轮未联网核验。没有产品/数据集版本、实际抓取时刻、误差估计或独立观测对照，因此不能确认趋势、异常、因果、水团归属或海区整体状态。

R2021a、R2024b、R2026a 的原生执行、字体实际选择、PNG/PDF、图元复核、视觉与交互均 pending。本轮未运行 MATLAB、Octave、评测 reader、旧 CI 或服务验收。manifest 草案 figures=[]，没有原生制品路径、尺寸实测、制品哈希或通过声明。自然语言说明与静态核对不等于机器审计通过。

reportId 固定为 astra-argo-round24。服务要求源码带 reportId 前缀，与可直接调用函数的合法 basename astra_argo_trial.m 存在已知冲突。保留此命名，不复制、不重命名、不修改服务或 guard。首轮 policy 尚未绑定；协调器下一轮应如实记录 source-missing。当前没有该服务响应，最终 manifest 绑定路径仍须服务响应确认。完整报告门槛没有下调，本 component 预期 complete=false。

## 文件与输入标识

输入文件：`argo-4903822-30d.json`；58061 bytes。SHA-256：`33959a0d9296cf3d0739375d0d551550d493dddbe3aa8cc3606b67ac7df0b7fa`。snapshot_id：`argo-4903822-33959a0d9296`。本轮抓取时间、缓存年龄、数据延迟与上游版本均未知；最新声明剖面时间为 2026-08-27T04:54:30.000Z，不能用原 date_updated_argovis 替代实际 fetched_at。

- [generated/astra_argo_trial.m](astra_argo_trial.m)
- [generated/astra-argo-round24.md](astra-argo-round24.md)
- [generated/astra-argo-round24.html](astra-argo-round24.html)
- [generated/astra-argo-round24-points.html](astra-argo-round24-points.html)
- [generated/astra-argo-round24-figures.json](astra-argo-round24-figures.json)
- [generated/astra-argo-round24-build.mjs](astra-argo-round24-build.mjs)

仅 1 个浏览器逐点辅助视图；原生 PNG/PDF 为 0 件。不扩展为完整海区报告，不增加凑数图件。草案 manifest 路径并非已绑定服务路径。
