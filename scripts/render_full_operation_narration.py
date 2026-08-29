from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path

import edge_tts


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "full-operation-demo-2026-08-29"
VOICE = "zh-CN-XiaoxiaoNeural"

SEGMENTS = [
    {
        "id": "01-intro",
        "title": "项目介绍",
        "text": "大家好，这是海洋智能分析平台的完整操作演示。平台把多源海洋观测、异常候选、事件证据、地图分析、浮标剖面和数据智能体集中在同一个研究工作台中。",
    },
    {
        "id": "02-login",
        "title": "登录工作台",
        "text": "首先进入账户入口。输入邮箱和密码后点击进入工作台。系统使用受保护会话，账户之间的对话、记忆和模型接口配置相互隔离。首次使用也可以切换到注册页面创建研究账户。",
    },
    {
        "id": "03-overview",
        "title": "首页总览",
        "text": "登录后首先看到实时海域观测总览。顶部给出数据来源数量、在线浮标数量和当前异常候选数量。入门模式适合快速阅读，专业模式会展示更完整的监测指标、事件队列和科学研判信息。",
    },
    {
        "id": "04-region",
        "title": "切换海域",
        "text": "在海域选择器中，可以切换西北太平洋、南海、印度洋、北大西洋、南太平洋、地中海和全球海洋。这里选择南海，系统会重新加载该区域的事件、观测、浮标和地图范围。",
    },
    {
        "id": "05-guide-brief",
        "title": "教程与简报",
        "text": "新手教程用三步说明怎样读懂一片海。今日简报会自动汇总全球态势、重点事件、Argo 活跃情况、Copernicus 数据量和来源状态，适合值班人员先快速掌握当天重点。",
    },
    {
        "id": "06-queue",
        "title": "事件队列",
        "text": "事件队列把普通观测、异常候选和已经形成档案的事件分开显示。可以按碳、海流、盐度、营养盐、叶绿素、海温、海况、风场和台风筛选，再点击任意记录进入调查。",
    },
    {
        "id": "07-detail",
        "title": "事件详情",
        "text": "事件详情包含概览、证据、研判报告、文献依据和观测概览。概览解释发生了什么以及为什么值得关注；证据页展示原始记录和置信度；报告页给出推理、影响和不确定性；文献页用于核对科学背景。",
    },
    {
        "id": "08-sources-layout",
        "title": "来源与布局",
        "text": "点击数据来源按钮，可以查看每个上游服务的状态、说明和观测数量。左右面板可以随时隐藏或恢复，长屏模式适合连续阅读，并排模式适合同时比较事件队列、地图和详情。",
    },
    {
        "id": "09-map-probe",
        "title": "地图与坐标探针",
        "text": "地图展示事件位置、Argo 浮标、卫星格点和准实时海流。点击海面位置会打开坐标探针，系统自动判断海陆、读取海表温度、风浪、水深、海域背景，并匹配附近最近的 Argo 浮标和历史剖面。",
    },
    {
        "id": "10-buoys",
        "title": "浮标总览",
        "text": "浮标总览用于浏览区域内的 Argo 平台。可以搜索平台编号，只看已监控浮标，查看最新位置、时间、变量和生物地球化学能力，再从列表定位到地图或打开详细剖面。",
    },
    {
        "id": "11-agent",
        "title": "海洋数据 Agent",
        "text": "海洋数据 Agent 支持快速检索和深度研判。提问时建议明确海域、变量和时间范围。智能体会通过 Ocean MCP 读取区域、事件、证据、来源和浮标数据，并保留工具轨迹、引用和会话历史。",
    },
    {
        "id": "12-account",
        "title": "账户与模型设置",
        "text": "账户设置中可以选择 OpenAI、DeepSeek 或自定义接口，填写服务地址、模型和个人 API 密钥，并进行连接测试。密钥由服务端加密保存，不写入浏览器本地存储。演示时不要公开真实密钥。",
    },
    {
        "id": "13-summary",
        "title": "使用建议",
        "text": "完整使用顺序可以概括为：先看今日简报，再选择海域；从事件队列找到重点记录；结合地图、探针、浮标剖面、证据和文献完成复核；最后让数据 Agent 生成可追溯的分析。异常候选不等于最终结论，仍需持续观测和人工复核。",
    },
]


def seconds(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def timestamp(value: float) -> str:
    millis = round(value * 1000)
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


async def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    audio_dir = OUTPUT / "audio"
    audio_dir.mkdir(exist_ok=True)

    rendered = []
    for segment in SEGMENTS:
        target = audio_dir / f"{segment['id']}.mp3"
        communicator = edge_tts.Communicate(segment["text"], VOICE, rate="-4%", volume="+0%")
        await communicator.save(str(target))
        rendered.append({**segment, "audio": str(target), "duration": seconds(target)})

    cursor = 0.0
    srt_lines = []
    markdown_lines = ["# 海洋智能分析平台全量操作视频文案", ""]
    concat_lines = []
    for index, segment in enumerate(rendered, start=1):
        start = cursor
        end = cursor + segment["duration"]
        segment["start"] = start
        segment["end"] = end
        cursor = end
        srt_lines.extend(
            [
                str(index),
                f"{timestamp(start)} --> {timestamp(end)}",
                segment["text"],
                "",
            ]
        )
        markdown_lines.extend(
            [
                f"## {index:02d}. {segment['title']}",
                "",
                segment["text"],
                "",
            ]
        )
        concat_lines.append(f"file '{segment['audio']}'")

    (OUTPUT / "segments.json").write_text(json.dumps(rendered, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT / "ocean-intelligence-full-operation.srt").write_text("\n".join(srt_lines), encoding="utf-8")
    (OUTPUT / "voiceover-script.md").write_text("\n".join(markdown_lines), encoding="utf-8")
    concat_file = OUTPUT / "audio-concat.txt"
    concat_file.write_text("\n".join(concat_lines), encoding="utf-8")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c:a",
            "libmp3lame",
            "-b:a",
            "160k",
            str(OUTPUT / "voiceover.mp3"),
        ],
        check=True,
    )


if __name__ == "__main__":
    asyncio.run(main())
