# 海洋智能分析平台全量操作演示

生成日期：2026 年 8 月 29 日

公网播放地址：`https://ocean.hegelsalon.com/video/index.html`

## 主要交付物

- `ocean-intelligence-full-operation-cn.mp4`：最终成片，1280×720，中文配音，画面内嵌章节字幕，并包含可开关的简体中文字幕轨。
- `ocean-intelligence-full-operation.srt`：独立中文字幕文件。
- `voiceover-script.md`：按章节整理的完整配音文案。
- `voiceover.mp3`：独立中文配音音轨。
- `01-project-intro.png` 至 `20-summary.png`：全流程关键截图。
- `ocean-intelligence-full-operation-raw.webm`：未合成配音的原始录屏。

## 视频章节

1. 项目介绍
2. 登录工作台
3. 首页总览
4. 切换海域
5. 新手教程与今日简报
6. 事件队列与分类筛选
7. 事件概览、证据、报告、文献和观测
8. 数据来源、面板和布局控制
9. 地图与海面坐标探针
10. Argo 浮标总览
11. 海洋数据 Agent
12. 账户与模型 API 设置
13. 推荐的完整使用顺序

## 说明

- 视频使用独立演示账户录制，没有展示真实 API 密钥。
- 画面中的观测数量和事件内容来自录制时的系统数据，因此后续运行时数值可能变化。
- 平台中的“异常候选”是自动筛查结果，不等同于已确认科学结论，仍需持续观测和人工复核。

## 重新生成

先生成旁白、字幕和时间轴：

```bash
python3 scripts/render_full_operation_narration.py
```

再使用演示账户录屏：

```bash
OCEAN_DEMO_EMAIL='demo@example.com' \
OCEAN_DEMO_PASSWORD='replace-with-demo-password' \
node scripts/generate_full_operation_demo.mjs
```

最后使用 `ffmpeg` 将原始录屏、`voiceover.mp3` 和 SRT 字幕合成为 MP4。
