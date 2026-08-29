#!/usr/bin/env python3
from __future__ import annotations

import csv
import glob
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


CODEX_HOME = Path(os.environ.get("CODEX_HOME", "/root/.codex"))
PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", "/opt/ocean-intelligence"))
OUTPUT_DIR = PROJECT_ROOT / "audits"


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def redact(text: str) -> str:
    text = re.sub(
        r"(?i)\b(api[_ -]?key|token|secret|password|密码|密钥)\s*[:=：]?\s*[A-Za-z0-9_./+\-=]{12,}",
        lambda match: f"{match.group(1)}=[已遮盖]",
        text,
    )
    text = re.sub(r"\b[a-fA-F0-9]{32,}\b", "[疑似密钥已遮盖]", text)
    text = re.sub(
        r"\b([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)(@)([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b",
        lambda match: f"{match.group(1)}***{match.group(3)}{match.group(4)}",
        text,
    )
    return text


def load_records() -> dict:
    sessions = sorted(glob.glob(str(CODEX_HOME / "sessions" / "**" / "*.jsonl"), recursive=True))
    messages: list[dict] = []
    calls: list[dict] = []
    patches: list[dict] = []
    web_calls = 0
    session_ids: set[str] = set()
    task_started = 0
    task_complete = 0
    turn_aborted = 0

    for filename in sessions:
        file_meta: dict = {}
        with open(filename, encoding="utf-8") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                payload = record.get("payload") or {}
                record_type = record.get("type")
                payload_type = payload.get("type")
                if record_type == "session_meta":
                    file_meta = payload
                    session_id = payload.get("id") or payload.get("session_id")
                    if session_id:
                        session_ids.add(session_id)
                elif record_type == "event_msg" and payload_type == "user_message":
                    messages.append(
                        {
                            "timestamp": record.get("timestamp", ""),
                            "session_id": file_meta.get("id") or file_meta.get("session_id") or "",
                            "cwd": file_meta.get("cwd", ""),
                            "message": payload.get("message", ""),
                        }
                    )
                elif record_type == "event_msg" and payload_type == "patch_apply_end":
                    patches.append(payload)
                elif record_type == "event_msg" and payload_type == "task_started":
                    task_started += 1
                elif record_type == "event_msg" and payload_type == "task_complete":
                    task_complete += 1
                elif record_type == "event_msg" and payload_type == "turn_aborted":
                    turn_aborted += 1
                elif record_type == "response_item" and payload_type in {"function_call", "custom_tool_call"}:
                    calls.append(payload)
                elif record_type == "response_item" and payload_type == "web_search_call":
                    web_calls += 1

    return {
        "session_files": len(sessions),
        "session_ids": session_ids,
        "messages": sorted(messages, key=lambda row: row["timestamp"]),
        "calls": calls,
        "patches": patches,
        "web_calls": web_calls,
        "task_started": task_started,
        "task_complete": task_complete,
        "turn_aborted": turn_aborted,
    }


def indexed_task_count() -> int:
    path = CODEX_HOME / "session_index.jsonl"
    if not path.exists():
        return 0
    with path.open(encoding="utf-8") as handle:
        return sum(1 for line in handle if line.strip())


def load_index_titles() -> dict[str, str]:
    path = CODEX_HOME / "session_index.jsonl"
    titles: dict[str, str] = {}
    if not path.exists():
        return titles
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            session_id = row.get("id")
            title = re.sub(r" \(2\)$", "", row.get("thread_name", ""))
            if session_id and title:
                titles[session_id] = title
    return titles


def load_session_actions() -> list[dict]:
    titles = load_index_titles()
    actions: list[dict] = []
    for filename in sorted(glob.glob(str(CODEX_HOME / "sessions" / "**" / "*.jsonl"), recursive=True)):
        meta: dict = {}
        prompts: list[str] = []
        final_messages: list[str] = []
        changed_files = Counter()
        change_types = Counter()
        patch_count = 0
        for line in open(filename, encoding="utf-8"):
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            payload = record.get("payload") or {}
            record_type = record.get("type")
            payload_type = payload.get("type")
            if record_type == "session_meta":
                meta = payload
            elif record_type == "event_msg" and payload_type == "user_message":
                message = normalize(payload.get("message", ""))
                if message:
                    prompts.append(message)
            elif record_type == "event_msg" and payload_type == "patch_apply_end" and payload.get("success"):
                patch_count += 1
                for changed_file, change in (payload.get("changes") or {}).items():
                    changed_files[changed_file] += 1
                    change_types[change.get("type", "unknown")] += 1
            elif record_type == "event_msg" and payload_type == "task_complete":
                final_message = normalize(payload.get("last_agent_message", ""))
                if final_message:
                    final_messages.append(final_message)
        session_id = meta.get("id") or meta.get("session_id") or ""
        if session_id not in titles or not prompts:
            continue
        actions.append(
            {
                "session_id": session_id,
                "title": titles[session_id],
                "timestamp": meta.get("timestamp", ""),
                "cwd": meta.get("cwd", ""),
                "prompts": prompts,
                "final": final_messages[-1] if final_messages else "",
                "patch_count": patch_count,
                "changed_files": changed_files,
                "change_types": change_types,
            }
        )
    return sorted(actions, key=lambda row: row["timestamp"])


def action_category(title: str, prompts: list[str]) -> str:
    text = f"{title} {' '.join(prompts)}".lower()
    if any(keyword in text for keyword in ["地图", "前端", "banner", "探针", "拖动", "浮标", "定位"]):
        return "前端、地图与交互"
    if any(keyword in text for keyword in ["copernicus", "argo", "海流", "碳", "简报", "七日", "数据量"]):
        return "数据接入、科学分析与简报"
    if any(keyword in text for keyword in ["codex", "agent", "报告", "助手", "mcp"]):
        return "Codex Agent 与报告"
    if any(keyword in text for keyword in ["登录", "用户", "内存", "存储", "cloudflare", "1033", "公网", "服务器", "备份", "ssh"]):
        return "账户、部署与服务器运维"
    if any(keyword in text for keyword in ["搜索引擎", "项目说明", "ppt"]):
        return "文档、推广与交付"
    return "其他任务"


def write_product_action_report(actions: list[dict], path: Path) -> None:
    grouped: dict[str, list[dict]] = {}
    for action in actions:
        grouped.setdefault(action_category(action["title"], action["prompts"]), []).append(action)
    category_order = [
        "前端、地图与交互",
        "数据接入、科学分析与简报",
        "Codex Agent 与报告",
        "账户、部署与服务器运维",
        "文档、推广与交付",
        "其他任务",
    ]
    lines = [
        "# Codex 具体产品动作审计",
        "",
        f"> 生成时间：{datetime.now(timezone.utc).isoformat(timespec='seconds')}。按任务会话合并重复分支，共 {len(actions)} 个任务。",
        "",
        "每项均列出用户的具体产品要求、实际补丁和任务完成说明。敏感密钥、邮箱已遮盖。",
    ]
    number = 0
    for category in category_order:
        category_actions = grouped.get(category, [])
        if not category_actions:
            continue
        lines.extend(["", f"## {category}", ""])
        for action in category_actions:
            number += 1
            lines.extend(
                [
                    f"### {number}. {redact(action['title'])}",
                    "",
                    f"- 时间：`{action['timestamp']}`；会话：`{action['session_id']}`。",
                    "- 你提出的具体动作：",
                ]
            )
            for prompt_index, prompt in enumerate(action["prompts"], 1):
                lines.append(f"  {prompt_index}. {redact(prompt)}")
            if action["changed_files"]:
                lines.append(
                    f"- 实际代码补丁：{action['patch_count']} 次；新增 {action['change_types']['add']} 个文件，更新 {action['change_types']['update']} 个文件。"
                )
                lines.append("- 实际修改文件：")
                for filename, count in action["changed_files"].most_common():
                    lines.append(f"  - `{filename}`（{count} 次）")
            else:
                lines.append("- 实际代码补丁：无结构化补丁记录，主要为检查、查询、运维或内容交付。")
            if action["final"]:
                lines.append(f"- Codex 最终交付说明：{redact(action['final'])}")
            else:
                lines.append("- Codex 最终交付说明：日志中没有完整的任务完成消息。")
            lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_instruction_csv(messages: list[dict], path: Path) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["序号", "UTC时间", "会话ID", "工作目录", "指令（敏感信息已遮盖）"])
        for index, row in enumerate(messages, 1):
            writer.writerow(
                [index, row["timestamp"], row["session_id"], row["cwd"], redact(normalize(row["message"]))]
            )


def analyze_calls(calls: list[dict], web_calls: int) -> tuple[Counter, Counter]:
    tool_counts = Counter()
    command_categories = Counter()
    for call in calls:
        name = call.get("name") or call.get("tool_name") or "unknown"
        tool_counts[name] += 1
        if name != "exec_command":
            continue
        arguments = call.get("arguments") or {}
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                arguments = {}
        command = str(arguments.get("cmd", "")).lower()
        if "apply_patch" in command:
            command_categories["包含 apply_patch"] += 1
        if re.search(r"(^|[;&|\n ])(pytest|npm test|npx playwright|playwright|vitest|node --test)", command):
            command_categories["测试命令"] += 1
        if re.search(r"(^|[;&|\n ])(npm run build|vite build|tsc|docker compose build)", command):
            command_categories["构建命令"] += 1
        if "docker compose" in command or "docker-compose" in command:
            command_categories["Docker Compose"] += 1
        if re.search(r"\bcurl\b|\bwget\b", command):
            command_categories["HTTP/下载检查"] += 1
        if re.search(r"\bgit\b", command):
            command_categories["Git 命令"] += 1
        if re.search(r"\bsystemctl\b|\bjournalctl\b", command):
            command_categories["服务运维命令"] += 1
    tool_counts["web_search"] += web_calls
    return tool_counts, command_categories


def keyword_counts(messages: list[dict]) -> Counter:
    keywords = [
        "Codex", "数据", "Copernicus", "风", "报告", "浮标", "前端", "Argo", "海流", "地图",
        "简报", "界面", "台湾", "速度", "服务器", "用户", "内存", "导出", "Agent", "登录",
        "测试", "存储", "部署", "备份", "天地图", "队列", "碳",
    ]
    result = Counter()
    for keyword in keywords:
        result[keyword] = sum(keyword.lower() in row["message"].lower() for row in messages)
    return result


def write_report(records: dict, csv_path: Path, report_path: Path) -> None:
    messages = records["messages"]
    nonblank = [row for row in messages if normalize(row["message"])]
    unique_messages = {normalize(row["message"]) for row in nonblank}
    dates = Counter(row["timestamp"][:10] for row in messages)
    workdirs = Counter(row["cwd"] for row in messages)
    tool_counts, command_categories = analyze_calls(records["calls"], records["web_calls"])
    keywords = keyword_counts(messages)

    patch_success = sum(bool(row.get("success")) for row in records["patches"])
    changed_files = Counter()
    change_types = Counter()
    for patch in records["patches"]:
        for filename, change in (patch.get("changes") or {}).items():
            changed_files[filename] += 1
            change_types[change.get("type", "unknown")] += 1

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lines = [
        "# Codex 云服务器使用审计",
        "",
        f"> 生成时间：{now}；数据源：`{CODEX_HOME}/sessions/**/*.jsonl` 和项目源码。",
        "",
        "## 核心统计",
        "",
        f"- 用户指令事件：**{len(messages)} 条**（非空 {len(nonblank)} 条，规范化后不同文本 {len(unique_messages)} 条）。",
        f"- 会话文件：**{records['session_files']} 个**；唯一会话 ID：**{len(records['session_ids'])} 个**；任务索引记录：**{indexed_task_count()} 条**。",
        f"- 时间范围：**{messages[0]['timestamp']}** 至 **{messages[-1]['timestamp']}**。",
        f"- 工具调用记录：**{sum(tool_counts.values())} 次**；任务开始 {records['task_started']} 次，完成 {records['task_complete']} 次，中止 {records['turn_aborted']} 次。",
        f"- 结构化补丁：**{len(records['patches'])} 次**，成功 {patch_success} 次；涉及 {len(changed_files)} 个不同文件。",
        "",
        "## 每日指令量",
        "",
    ]
    lines.extend(f"- {date}：{count} 条" for date, count in sorted(dates.items()))
    lines.extend(["", "## 工作目录分布", ""])
    lines.extend(f"- `{cwd or '(未知)'}`：{count} 条" for cwd, count in workdirs.most_common())
    lines.extend(["", "## 高频主题（关键词命中，可重叠）", ""])
    lines.extend(f"- {keyword}：{count} 条" for keyword, count in keywords.most_common() if count)
    lines.extend(["", "## 工具动作", ""])
    lines.extend(f"- `{name}`：{count} 次" for name, count in tool_counts.most_common())
    lines.extend(["", "## Shell 动作类别（可重叠）", ""])
    lines.extend(f"- {name}：{count} 次" for name, count in command_categories.most_common())
    lines.extend(["", "## 代码改动", ""])
    lines.append(f"- 变更条目：{sum(changed_files.values())}；新增 {change_types['add']}；更新 {change_types['update']}。")
    lines.append("- 改动次数最多的文件：")
    lines.extend(f"  - `{filename}`：{count} 次" for filename, count in changed_files.most_common(25))
    lines.extend(
        [
            "",
            "## 已落地功能（源码与 README 可验证）",
            "",
            "- 多源海洋数据接入：Argo、NOAA、Copernicus Marine、文献与海洋知识数据。",
            "- Copernicus 海流、风浪、历史点位、每日索引、全球数据量统计、缓存和降级链路。",
            "- Argo 浮标地图、浮标列表、最近浮标、剖面调查、质量控制与数据导出。",
            "- 每日海洋智能简报，将 Argo 与 Copernicus 数据组织为可追溯报告。",
            "- 中国标准地图、天地图底图、南海要素、中文注记、海流粒子动画和坐标探针。",
            "- 观测、异常候选、事件档案、证据链、时间线、不确定性和报告解释。",
            "- Codex 海洋数据 Agent：线程、流式轨迹、Ocean MCP、记忆隔离和报告质量约束。",
            "- 登录、Session、CSRF、用户/线程隔离、PostgreSQL 持久化与生产同源访问。",
            "- Docker Compose、Caddy/HTTPS、Ubuntu 部署、备份、缓存、性能指标和自动化测试。",
            "",
            "## 明细",
            "",
            f"- 全部指令逐条清单：`{csv_path}`。",
            "- CSV 中疑似密钥和邮箱已遮盖；原始记录仍保留在 Codex 本地会话文件中。",
            "- 统计是日志事件审计，不等于计费请求数；分支、重试和后台任务会增加会话与工具调用记录。",
        ]
    )
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    records = load_records()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    csv_path = OUTPUT_DIR / f"codex-instructions-{stamp}.csv"
    report_path = OUTPUT_DIR / f"codex-usage-audit-{stamp}.md"
    product_action_path = OUTPUT_DIR / f"codex-product-actions-{stamp}.md"
    write_instruction_csv(records["messages"], csv_path)
    write_report(records, csv_path, report_path)
    write_product_action_report(load_session_actions(), product_action_path)
    print(report_path)
    print(csv_path)
    print(product_action_path)


if __name__ == "__main__":
    main()
