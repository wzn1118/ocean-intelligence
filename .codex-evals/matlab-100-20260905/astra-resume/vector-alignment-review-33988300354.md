# 第七批矢量文字定位审查：33988300354

2026-09-05 UTC。指定目录已下载到位；只看 R2026a 四份 PDF 与 03 原 PNG、R2024b 04 PDF，共 **6/6 原件实际 view_image**。另只读两份同目录 probe JSON，不看主回归图、源码、score/audit，不运行 MATLAB。
API 完成与视觉合格分开：JSON 中 R26 四候选 exported，R24 仅 04 exported、01/02/03 skipped；这些不等于视觉通过。原件及两份 JSON 的前后 SHA256/字节数不变；仓库仅新增本报告，未提交推送。

## 结论与实验边界
- **R26 01、02、03 PDF 的标题右裁、Ylabel 上裁完全相同**；各自整页实际查看后，150 dpi 栅格逐像素比较也相同。重复同一 figure 导出，或真实 PNG 导出/测量/drawnow 预热，都没有在此 probe 修复 PDF 文字定位。
- **03 PNG 的长双语标题及完整 Ylabel 可读且位置正常**，而随后 PDF 丢失标题右段和中文、Ylabel 尾段；不能用 PNG 正常代签 PDF，也不能只归因为没有可用中文字形。
- **R26 04 能看到完整标题和中文，但标题仍显著偏右，Ylabel 沿左/上页边，布局不正常**。R24 04 相对更居中，中文可读，但 title/Ylabel/Xlabel 的页面边界仍过紧，bbox 有越界，不能签无裁切。
- **04 不是单因素试验**：同时换成 fresh figure、target 从 figure 改 axes、去掉显式尺寸/figure padding 等选项，实际 PDF 页面尺寸也改变；不能得出“仅 Width/Height/Padding 有错”“改 axes 就彻底修好”或“tight 只改变 sizing”的结论。

## 候选条件
条件来自哈希绑定的 probe JSON，不是本轮重跑或源码推断；四份均请求 `exportgraphics`、vector、白底。
| 候选 | figure_instance_id / 前置 | export_target_class / 选项 |
| --- | --- | --- |
| R26 01-exact-first | shared-exact，首次 | matlab.ui.Figure；Units=inches、Width=8、Height=5、Padding=figure、PreserveAspectRatio=on |
| R26 02-exact-second | 同一 shared-exact，前驱 01 | 同 01 target 与选项 |
| R26 03 PDF + PNG | fresh-png；PNG 实际导出、解码、测量 2400 x 1500，随后 drawnow 完成 | PDF 同 01 target 与选项；不是 02 那个 figure |
| R26/R24 04-native-tight | 各自 fresh-tight，无 PNG 前置 | matlab.graphics.axis.Axes；仅 ContentType=vector、BackgroundColor=white，无显式尺寸参数 |
所有 exported 候选的 after_native_attempt 快照仍记 Title/ YLabel 的 HorizontalAlignment=center、VerticalAlignment=bottom，YLabel Rotation=90。公共属性是元数据，不等于 PDF 中已经实现了这些对齐，也未把 raw Extent 冒充页面 bbox。

## PDF 信息与查看方法
五份 PDF 均单页；用现有 Poppler 22.02.0 执行 `pdftoppm -f 1 -singlefile -r 150 -png`，整页副本分别 view_image，未裁边或补画。03 PNG 直接看原件。
| PDF | pdfinfo 页面 / 整页预览 | pdffonts 实际结果 |
| --- | --- | --- |
| R26 01、02、03 | 各 576 x 360 pt；1200 x 750 px；Qt 6.8.1 | WenQuanYiZenHei，CID TrueType，Identity-H，emb=yes、sub=no、uni=yes |
| R26 04 | **670 x 435 pt**；1396 x 907 px；Qt 6.8.1 | 同上，嵌入不证明几何正确 |
| R24 04 | **451 x 325 pt**；940 x 678 px；Apache FOP | EAAAAA+WenQuanYiZenHei，CID TrueType，Identity-H，emb=yes、sub=yes、uni=yes；本 probe 不是此前 Courier 成品的字体结果 |

## 逐件图面定位
| 原件 | title / Ylabel 实际所见 |
| --- | --- |
| R26 01 PDF | 标题从绘图区中部附近向右展开，右侧英文和全部中文超出页边；Ylabel 向上偏，reference 后说明被页顶截去。Xlabel 完整但偏右。 |
| R26 02 PDF | 已单独查看，位置与裁切同 01；再次导出没有可见改善。 |
| R26 03 PDF | 已单独查看，同 01；不能将前置 PNG/drawnow 完成解释为预热修复成功。 |
| R26 03 PNG | 完整标题 `Ocean temperature profiles: Station A and Station B - 南海温度剖面` 位于图上方，长 Ylabel 完整沿左轴居中；中文无明显方框字。点、线段与缺口可见，不验证科学数据。 |
| R26 04 PDF | 完整双语标题可辨但仍偏右、末端接近右页边，页面上部有大块留白；Ylabel 全句大体可辨但贴左/上边界，不能签外缘字形完整。Xlabel 完整、靠页底。 |
| R24 04 PDF | 完整双语标题可辨且相对绘图区较居中；标题贴页顶，长 Ylabel 贴左边，Xlabel 贴页底，边界无安全留白。不据字体嵌入判布局通过。 |

## pdftotext Bbox 实际文字
执行 `pdftotext -bbox-layout <原PDF> -`，用 XML 解析器读取 line/word；坐标为 `(xMin,yMin,xMax,yMax)`，单位 pt、页面左上为原点。表中是**实际抽取字符串及行框**，不是把 source.title 当成 PDF 已有文字；框与可见字形边缘不完全等同。
| PDF / 对象 | 实际抽取文字 | bbox |
| --- | --- | --- |
| R26 01、02、03 / title，各自相同 | Ocean temperature profiles: Station A and Stati | (287.500, 2.504, 577.784, 20.141)；xMax > 页宽 576，中文未抽出且图面不可见 |
| R26 01、02、03 / Ylabel，各自相同 | Depth (m, positive down; reference | (38.808, 0.766, 53.925, 184.000)；只是页内残串，不能据框内坐标说全标签完整 |
| R26 01、02、03 / Xlabel，各自相同 | Temperature (degC) | (287.500, 336.208, 390.772, 351.325) |
| R26 04 / title | Ocean temperature profiles: Station A and Station B - 南海温度剖面 | (249.375, 91.733, 668.690, 109.028)；右缘距页边约 1.310 pt |
| R26 04 / Ylabel | Depth (m, positive down; reference: mean sea level) | (-2.036, 1.473, 13.247, 269.717)；左越界 |
| R26 04 / Xlabel | Temperature (degC) | (249.375, 418.979, 353.776, 433.803)；页高 435 |
| R24 04 / title | Ocean temperature profiles: Station A and Station B - 南海温度剖面 | (31.075, -1.593, 445.839, 16.019)；上越界 |
| R24 04 / Ylabel | Depth (m, positive down; reference: mean sea level) | (-3.169, 17.920, 11.927, 291.388)；左越界 |
| R24 04 / Xlabel | Temperature (degC) | (187.075, 310.044, 290.323, 325.140)；yMax > 页高 325 |
R26 01/02/03 的原 PDF 哈希不同，但查看副本 SHA256 完全相同，Pillow ImageChops 对 01-vs-02、01-vs-03 的 difference bbox 均为 None，实际抽取文字/bbox 也相同。仅证明本 probe 重复导出/该预热不足；没有证明所有延迟布局问题都可排除。
根因线索限于“矢量输出中的文本锚点/裁切与 PNG 不一致，tight 路径仍有偏位”。04 的更大页面让更多文字入页，不等于对齐已纠正；尚不能隔离 sizing、target、fresh figure 或版本实现的独立贡献。本次不修代码、不扩展实验，不宣称 CI/交互/全量通过。

## 原件与元数据 SHA256
| 文件 | SHA256 |
| --- | --- |
| [R26 01 PDF](/tmp/matlab-run-33988300354/matlab-full100-R2026a/vector-text-alignment-probe/01-exact-first.pdf) | `97b7312f08e12b7041a5654135622281f276ccd7e36d92a30a86736ccce34980` |
| [R26 02 PDF](/tmp/matlab-run-33988300354/matlab-full100-R2026a/vector-text-alignment-probe/02-exact-second.pdf) | `0c80279039835583681085fe05d3979e7bda086b0fd1c38df5dedfbf6f324d18` |
| [R26 03 PDF](/tmp/matlab-run-33988300354/matlab-full100-R2026a/vector-text-alignment-probe/03-png-measure-drawnow-exact.pdf) | `5135ade2613dcf6fb3296f545e07b6b4f1a6cea863c604dbdef7fe924fd119fe` |
| [R26 03 PNG](/tmp/matlab-run-33988300354/matlab-full100-R2026a/vector-text-alignment-probe/03-png-measure-drawnow-exact.png) | `261fe92a420d1d15ac37f6ef6fd24a94f81836b0fa41dca6fd63a6115175db62` |
| [R26 04 PDF](/tmp/matlab-run-33988300354/matlab-full100-R2026a/vector-text-alignment-probe/04-native-tight.pdf) | `1b1a1ca719e8fc7d83b93927578b8e1c7269482cb3d5451a90c1daa1ad45f6b7` |
| [R24 04 PDF](/tmp/matlab-run-33988300354/matlab-full100-R2024b/vector-text-alignment-probe/04-native-tight.pdf) | `3702c949e559f5e2b8a174f66550cb1e8cc3e79295ab75fe4a9ce4bd5fd6f42f` |
| [R26 probe JSON，只读元数据](/tmp/matlab-run-33988300354/matlab-full100-R2026a/vector-text-alignment-probe/vector-text-alignment.json) | `878594270828f3a2fa6d0c213531520afc5dba37a76248781102867baab4ff17` |
| [R24 probe JSON，只读元数据](/tmp/matlab-run-33988300354/matlab-full100-R2024b/vector-text-alignment-probe/vector-text-alignment.json) | `4f83b89d260bd240aeea18908dd0969e2674dfd36bc20445a0197990f4dd8ec1` |

## 整页查看副本 SHA256
| 已实际 view_image 的副本 | SHA256 |
| --- | --- |
| [R26 01](/tmp/matlab-visual-baseline/33988300354/R2026a-01-exact-first.png) | `5626bc622202ddb750f8679d4e0a79c7d7978e7f1748f8622eb1998d51a67b83` |
| [R26 02](/tmp/matlab-visual-baseline/33988300354/R2026a-02-exact-second.png) | `5626bc622202ddb750f8679d4e0a79c7d7978e7f1748f8622eb1998d51a67b83` |
| [R26 03](/tmp/matlab-visual-baseline/33988300354/R2026a-03-png-measure-drawnow-exact.png) | `5626bc622202ddb750f8679d4e0a79c7d7978e7f1748f8622eb1998d51a67b83` |
| [R26 04](/tmp/matlab-visual-baseline/33988300354/R2026a-04-native-tight.png) | `5757a555506e71a0724e2115865e6a10480e00a8488455889cc64a0845b659f8` |
| [R24 04](/tmp/matlab-visual-baseline/33988300354/R2024b-04-native-tight.png) | `4eb17dd194f36502becc190badf0e2c4a612a37047eeceba9df364eabe719e03` |
