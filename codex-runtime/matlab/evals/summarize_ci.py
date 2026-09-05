"""Offline MATLAB CI summary. Exit 0 means the report was generated, not CI passed.

Required stages are the historical core plus every ID observed in this download.
This handles growing stage lists without applying today's runner to older runs.
No score or visual approval is inferred from a runtime pass.
"""

from __future__ import annotations

import argparse
import html
import json
import math
from pathlib import Path
from typing import Any


RELEASES = ("R2021a", "R2024b", "R2026a")
CORE_STAGES = (
    "plot-regression", "family-a-contracts", "family-b-runtime",
    "family-c-contracts", "export-runtime", "interaction-headless",
    "evaluator-runtime",
)
STATUSES = ("passed", "failed", "pending", "running")
POSTPROCESSING_FILES = ("rendered-artifact-evidence.json", "ci-validation-summary.json")
DISPLAY_FILE = "display-comparison/display-rendering.json"
DISPLAY_CASES = ("publication", "native-pdf-page-probe", "vector-text-alignment-probe")
DISPLAY_STATUSES = ("running", "completed_pending_external_review", "completed_with_failures")
DISPLAY_CASE_STATUSES = ("pending", "running", "export_checks_completed", "failed")
NOTICE = (
    "CI 状态为本地证据推断，未提供 GitHub 状态、未查询远端，不重新验真。"
    "已知后处理失败优先于缺少视觉审核的 pending。运行阶段 passed 不代表 100 分或渲染/视觉通过；"
    "分数与视觉审核仅转述评分器，缺少证据为 pending。"
    "自动产物检查 passed 也不代表人工视觉审核通过。"
)


def first_line(value: Any) -> str:
    return next((line.strip() for line in str(value).splitlines() if line.strip()), "")


def issue(issues: list, source: str, identifier: str, message: str,
          status: str = "failed") -> None:
    issues.append({"source": source, "identifier": identifier,
                   "message": first_line(message), "status": status})


def reject_constant(value: str) -> None:
    raise ValueError("JSON 含非有限数字: " + value)


def unique_json_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("JSON 含重复 key: " + key)
        result[key] = value
    return result


def read_json(path: Path, issues: list, optional: bool = False) -> dict | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_constant,
                             object_pairs_hook=unique_json_object)
        if not isinstance(payload, dict):
            raise ValueError("JSON 顶层必须是对象")
        return payload
    except FileNotFoundError:
        if not optional:
            issue(issues, path.name, "ci_summary:MissingFile", "缺少 " + path.name, "pending")
    except (OSError, UnicodeError, ValueError) as error:
        issue(issues, path.name, "ci_summary:InvalidJSON", str(error))
    return None


def collect_errors(record: Any, source: str, issues: list, depth: int = 0) -> None:
    if not record:
        return
    if depth > 8:
        issue(issues, source, "ci_summary:InvalidError", "错误记录嵌套过深")
    elif isinstance(record, str):
        try:
            nested = json.loads(record)
        except ValueError:
            nested = None
        if isinstance(nested, (dict, list)):
            before = len(issues)
            collect_errors(nested, source, issues, depth + 1)
            if len(issues) > before:
                return
        issue(issues, source, "(无 identifier)", record)
    elif isinstance(record, list):
        for item in record:
            collect_errors(item, source, issues, depth + 1)
    elif isinstance(record, dict):
        identifier = record.get("error_identifier") or record.get("identifier")
        message = record.get("error_message") or record.get("message") or record.get("error_report")
        if identifier or message:
            issue(issues, source, first_line(identifier or "(无 identifier)"), message or "未提供错误消息")
        for key in ("error", "errors", "causes"):
            collect_errors(record.get(key), source, issues, depth + 1)
    else:
        issue(issues, source, "ci_summary:InvalidError", "错误记录格式无效")


def normalize_status(record: dict, source: str, issues: list,
                     evaluator: bool = False) -> str:
    before = len(issues)
    collect_errors(record, source, issues)
    status = record.get("status")
    if evaluator and status == "runtime_pending":
        status = "pending"
    if not isinstance(status, str) or status not in STATUSES:
        issue(issues, source, "ci_summary:InvalidStatus", "无效状态: " + repr(status))
        return "failed"
    if status == "failed" and len(issues) == before:
        issue(issues, source, "(无 identifier)", "状态为 failed，未提供错误消息")
    return "failed" if len(issues) > before else status


def combined_status(statuses: list[str]) -> str:
    for status in ("failed", "running", "pending"):
        if status in statuses:
            return status
    return "passed" if statuses else "pending"


def counts(statuses: list[str]) -> dict:
    return {"total": len(statuses), **{status: statuses.count(status) for status in STATUSES}}


def read_stages(payload: dict | None, release: str, issues: list) -> dict:
    if payload is None:
        return {}
    source = "ci-stage-status.json"
    if payload.get("expected_release") != release:
        issue(issues, source, "ci_summary:ReleaseMismatch", "expected_release 与目录版本不符或缺失")
        return {}
    if payload.get("schema_version", 1) != 1:
        issue(issues, source, "ci_summary:InvalidSchema", "不支持的阶段文件 schema_version")
        return {}
    records = payload.get("stages")
    if isinstance(records, dict) and "id" in records:
        records = [records]
    if not isinstance(records, list):
        issue(issues, source, "ci_summary:InvalidStages", "stages 必须为数组或单个 MATLAB 阶段对象")
        return {}
    stages = {}
    for record in records:
        if (not isinstance(record, dict) or not isinstance(record.get("id"), str)
                or not record["id"].strip() or record["id"] != record["id"].strip()):
            issue(issues, source, "ci_summary:InvalidStage", "阶段缺少有效 id")
            collect_errors(record, source, issues)
            continue
        identifier = record["id"]
        status = normalize_status(record, identifier, issues)
        if identifier in stages:
            issue(issues, identifier, "ci_summary:DuplicateStage", "阶段 id 重复，不计为通过")
            status = "failed"
        stages[identifier] = {"id": identifier, "status": status, "reported_status": record.get("status")}
    return stages


def summarize_probe(payload: dict | None, release: str, issues: list) -> dict:
    source = "matlab-runtime-probe.json"
    if payload is None:
        return {"status": combined_status([item["status"] for item in issues if item["source"] == source])}
    before = len(issues)
    reported_status = normalize_status(payload, source, issues) if "status" in payload else "passed"
    if "status" not in payload:
        collect_errors(payload, source, issues)
    required = {"runtime": "matlab", "vendor": "MathWorks", "release": release,
                "matlab_license_tested": True, "matlab_license_available": True}
    for key, expected in required.items():
        actual = payload.get(key)
        if type(actual) is not type(expected) or actual != expected:
            issue(issues, source, "ci_summary:InvalidProbe", f"{key}: 预期 {expected!r}，实际 {actual!r}")
    status = combined_status([reported_status, "passed" if len(issues) == before else "failed"])
    return {"status": status, **{key: payload.get(key) for key in (
        "runtime", "vendor", "release", "version", "matlab_license_available",
        "jvm_available", "desktop_available", "display_available", "headless",
    )}}


def summarize_evaluator(payload: dict | None, issues: list) -> dict:
    source = "evaluator-result.json"
    result = {"status": "pending", "reported_status": None, "reported_score": None,
              "maximum_score": None, "visual_status": "pending"}
    if payload is None:
        result["status"] = combined_status([item["status"] for item in issues if item["source"] == source])
        return result
    before = len(issues)
    result["reported_status"] = payload.get("status")
    status = normalize_status(payload, source, issues, evaluator=True)
    score, maximum = payload.get("score"), payload.get("maximum_score")
    if score is not None or maximum is not None:
        if (type(score) in (int, float) and type(maximum) in (int, float)
                and math.isfinite(score) and math.isfinite(maximum) and 0 <= score <= maximum == 100):
            result.update(reported_score=score, maximum_score=maximum)
        else:
            issue(issues, source, "ci_summary:InvalidScore", "评分必须为 0 到 100 的有限数字，满分为 100")
    if status == "passed" and result["reported_score"] != 100:
        issue(issues, source, "ci_summary:InconsistentScore", "评分器 passed 但未报告有效的 100 分")
    gate_statuses = []
    runtime = payload.get("runtime")
    if runtime is not None:
        if isinstance(runtime, dict):
            gate_statuses.append(normalize_status(runtime, source + ":runtime", issues))
        else:
            issue(issues, source, "ci_summary:InvalidRuntime", "评分器 runtime 必须为对象")
    visual_gate = "pending"
    gates = payload.get("gates", [])
    if not isinstance(gates, list):
        issue(issues, source, "ci_summary:InvalidGates", "gates 必须为数组")
        gates = []
    seen = set()
    for gate in gates:
        if not isinstance(gate, dict) or not isinstance(gate.get("id"), str) or not gate["id"].strip():
            issue(issues, source, "ci_summary:InvalidGate", "评分器关卡缺少有效 id")
            continue
        identifier = gate["id"]
        gate_status = normalize_status(gate, source + ":" + identifier, issues)
        if identifier in seen:
            issue(issues, source, "ci_summary:DuplicateGate", "评分器关卡重复: " + identifier)
            gate_status = "failed"
        seen.add(identifier)
        gate_statuses.append(gate_status)
        if identifier == "artifact_visual_audit":
            visual_gate = gate_status
    visual = payload.get("visual_audit")
    visual_status = "pending"
    if visual is not None:
        if isinstance(visual, dict):
            visual_status = normalize_status(visual, source + ":visual_audit", issues)
        else:
            issue(issues, source, "ci_summary:InvalidVisualAudit", "visual_audit 必须为对象")
            visual_status = "failed"
    result["visual_status"] = combined_status([visual_gate, visual_status])
    result["status"] = combined_status([status, *gate_statuses, *(
        ["failed"] if len(issues) > before else []
    )])
    return result


def postprocessing_status(record: dict, source: str, identifier: str, issues: list,
                          children: list[str], rendered: bool) -> str:
    before = len(issues)
    collect_errors(record, source, issues)
    status = record.get("status")
    if rendered and status == "not_verified":
        status = "pending"
    if not isinstance(status, str) or status not in STATUSES:
        issue(issues, source, "ci_summary:InvalidStatus", f"{identifier}: 无效状态 {status!r}")
        status = "failed"
    elif status == "failed" and len(issues) == before and "failed" not in children:
        issue(issues, source, identifier,
              record.get("reason") or record.get("detail") or "状态为 failed，未提供错误消息")
    return combined_status([status, *children, *[item["status"] for item in issues[before:]]])


def postprocessing_checks(record: dict, source: str, issues: list, rendered: bool) -> list[str]:
    checks = record.get("checks")
    if not isinstance(checks, list):
        issue(issues, source, "ci_summary:InvalidChecks", "后处理 checks 必须为数组")
        return ["failed"]
    statuses = []
    key = "name" if rendered else "id"
    for index, check in enumerate(checks):
        if (not isinstance(check, dict) or not isinstance(check.get(key), str)
                or not check[key].strip()):
            issue(issues, source, "ci_summary:InvalidCheck", f"checks[{index}] 缺少有效 {key}")
            statuses.append("failed")
            collect_errors(check, source, issues)
            continue
        statuses.append(postprocessing_status(check, source, check[key], issues, [], rendered))
    return statuses


def summarize_postprocessing(directory: Path, release: str, issues: list) -> dict:
    sources = []
    for source in POSTPROCESSING_FILES:
        before = len(issues)
        payload = read_json(directory / source, issues, optional=True)
        if payload is None:
            if len(issues) > before:
                sources.append({"source": source, "status": "failed", "reported_status": None})
            continue
        rendered = source == "rendered-artifact-evidence.json"
        if type(payload.get("schema_version")) is not int or payload["schema_version"] != 1:
            issue(issues, source, "ci_summary:InvalidSchema", "不支持的后处理 schema_version")
        if not rendered and payload.get("expected_release") != release:
            issue(issues, source, "ci_summary:ReleaseMismatch", "expected_release 与目录版本不符或缺失")
        statuses = postprocessing_checks(payload, source, issues, rendered)
        if rendered:
            artifacts = payload.get("artifacts")
            if not isinstance(artifacts, list):
                issue(issues, source, "ci_summary:InvalidArtifacts", "artifacts 必须为数组")
                artifacts = []
            elif not artifacts:
                issue(issues, source, "ci_summary:MissingArtifacts",
                      "缺少逐产物检查记录，不能仅凭顶层检查认定产物通过", "pending")
            for index, artifact in enumerate(artifacts):
                if (not isinstance(artifact, dict) or not isinstance(artifact.get("file"), str)
                        or not artifact["file"].strip()):
                    issue(issues, source, "ci_summary:InvalidArtifact", f"artifacts[{index}] 缺少有效 file")
                    collect_errors(artifact, source, issues)
                    continue
                artifact_source = source + ":" + artifact["file"]
                children = postprocessing_checks(artifact, artifact_source, issues, rendered)
                statuses.append(postprocessing_status(
                    artifact, artifact_source, artifact["file"], issues,
                    [combined_status(children)], rendered))
        else:
            failures = payload.get("failures", [])
            if not isinstance(failures, list):
                issue(issues, source, "ci_summary:InvalidFailures", "failures 必须为数组")
                failures = []
            for failure in failures:
                if not isinstance(failure, str) or not failure.strip():
                    issue(issues, source, "ci_summary:InvalidFailure", "failure 必须为非空字符串")
                    continue
                identifier, separator, message = first_line(failure).partition(": ")
                if not separator:
                    identifier, message = "(无 identifier)", first_line(failure)
                if not any(item["source"] == source and item["identifier"] == identifier
                           and item["message"] == message for item in issues):
                    issue(issues, source, identifier, message)
        status = postprocessing_status(payload, source, "(无 identifier)", issues,
                                       [combined_status(statuses), *[
                                           item["status"] for item in issues[before:]]], rendered)
        sources.append({"source": source, "status": status, "reported_status": payload.get("status")})
    return {"status": combined_status([item["status"] for item in sources]), "sources": sources}


def summarize_display_diagnostics(directory: Path, release: str) -> dict:
    issues: list = []
    cases = {identifier: {"id": identifier, "status": "not_run", "reported_status": None,
                          "error_identifier": "", "error_message": ""}
             for identifier in DISPLAY_CASES}
    result = {"source": DISPLAY_FILE, "present": False, "status": "not_run",
              "reported_status": None, "release": release, "reported_release": None,
              "display": None, "cases": list(cases.values()), "issues": issues}
    payload = read_json(directory / DISPLAY_FILE, issues, optional=True)
    result["present"] = payload is not None or bool(issues)
    if payload is None:
        result["status"] = "failed" if issues else "not_run"
        return result
    for key in ("release", "display", "status"):
        output_key = {"release": "reported_release", "status": "reported_status"}.get(key, key)
        result[output_key] = payload.get(key) if isinstance(payload.get(key), str) else None
    required = {"schema_version": 1, "scope": "virtual_display_diagnostics_only",
                "release": release, "visual_verified": False, "desktop_interaction_verified": False}
    for key, expected in required.items():
        actual = payload.get(key)
        if type(actual) is not type(expected) or actual != expected:
            issue(issues, DISPLAY_FILE, "ci_summary:InvalidDisplayDiagnostics",
                  f"{key}: 预期 {expected!r}，实际 {actual!r}")
    for key in ("started_at", "version", "display"):
        if not isinstance(payload.get(key), str) or not payload[key].strip():
            issue(issues, DISPLAY_FILE, "ci_summary:InvalidDisplayDiagnostics", key + " 必须为非空字符串")
    for key in ("jvm_available", "desktop_available"):
        if type(payload.get(key)) is not bool:
            issue(issues, DISPLAY_FILE, "ci_summary:InvalidDisplayDiagnostics", key + " 必须为 bool")
    density = payload.get("screen_pixels_per_inch")
    if (type(density) not in (int, float) or density <= 0
            or (isinstance(density, float) and not math.isfinite(density))):
        issue(issues, DISPLAY_FILE, "ci_summary:InvalidDisplayDiagnostics", "screen_pixels_per_inch 必须为正有限数字")
    allowed = {*required, "started_at", "version", "display", "jvm_available", "desktop_available",
               "screen_pixels_per_inch", "status", "cases", "completed_at", "failed_count"}
    if payload.keys() - allowed:
        issue(issues, DISPLAY_FILE, "ci_summary:InvalidDisplayDiagnostics",
              "未知诊断字段: " + ", ".join(sorted(payload.keys() - allowed)))
    reported_status = result["reported_status"]
    if reported_status not in DISPLAY_STATUSES:
        issue(issues, DISPLAY_FILE, "ci_summary:InvalidStatus", "无效诊断状态: " + repr(reported_status))
    records = payload.get("cases")
    if not isinstance(records, list):
        issue(issues, DISPLAY_FILE, "ci_summary:InvalidDisplayCases", "cases 必须为三个 callback 的数组")
        records = []
    seen = set()
    for index, record in enumerate(records):
        if (not isinstance(record, dict) or not isinstance(record.get("id"), str)
                or record["id"] not in cases):
            issue(issues, DISPLAY_FILE, "ci_summary:InvalidDisplayCase", f"cases[{index}] 缺少已知 callback id")
            continue
        identifier = record["id"]
        source = DISPLAY_FILE + ":" + identifier
        if identifier in seen:
            issue(issues, source, "ci_summary:InvalidDisplayCase", "callback id 重复")
            cases[identifier]["status"] = "failed"
            continue
        seen.add(identifier)
        case = cases[identifier]
        status = record.get("status")
        case["reported_status"] = status if isinstance(status, str) else None
        case["status"] = status if isinstance(status, str) and status in DISPLAY_CASE_STATUSES else "failed"
        before = len(issues)
        if not isinstance(status, str) or status not in DISPLAY_CASE_STATUSES:
            issue(issues, source, "ci_summary:InvalidStatus", "无效 callback 状态: " + repr(status))
        if record.keys() - {"id", "status", "error_identifier", "error_message"}:
            issue(issues, source, "ci_summary:InvalidDisplayCase", "callback 含未知字段")
        for key in ("error_identifier", "error_message"):
            if not isinstance(record.get(key), str):
                issue(issues, source, "ci_summary:InvalidDisplayCase", key + " 必须为字符串")
            else:
                case[key] = first_line(record[key])
        if case["error_identifier"] or case["error_message"] or status == "failed":
            issue(issues, source, case["error_identifier"] or "(无 identifier)",
                  case["error_message"] or "callback 报告失败，未提供错误消息")
        if len(issues) > before:
            case["status"] = "failed"
    for identifier in cases:
        if identifier not in seen:
            issue(issues, DISPLAY_FILE + ":" + identifier, "ci_summary:InvalidDisplayCase", "缺少 callback 记录")
    statuses = [case["status"] for case in cases.values()]
    if reported_status in ("completed_pending_external_review", "completed_with_failures"):
        failure_count = payload.get("failed_count")
        if (type(failure_count) is not int or failure_count != statuses.count("failed")
                or any(status not in ("export_checks_completed", "failed") for status in statuses)
                or (reported_status == "completed_pending_external_review" and failure_count != 0)
                or (reported_status == "completed_with_failures" and failure_count == 0)):
            issue(issues, DISPLAY_FILE, "ci_summary:InconsistentDisplayStatus", "完成状态、failed_count 与 callback 状态不一致")
        if not isinstance(payload.get("completed_at"), str) or not payload["completed_at"].strip():
            issue(issues, DISPLAY_FILE, "ci_summary:InvalidDisplayDiagnostics", "完成状态缺少 completed_at")
    elif reported_status == "running" and any(key in payload for key in ("completed_at", "failed_count")):
        issue(issues, DISPLAY_FILE, "ci_summary:InconsistentDisplayStatus", "running 不应带最终完成字段")
    result["status"] = "failed" if issues else reported_status
    return result


def summarize(input_root: Path) -> dict:
    root = Path(input_root).resolve()
    if not root.is_dir():
        raise ValueError("输入目录不存在或不是目录: " + str(root))
    directories = {path.name.removeprefix("matlab-full100-"): path
                   for path in sorted(root.glob("matlab-full100-R*")) if path.is_dir()}
    releases = list(RELEASES) + sorted(directories.keys() - set(RELEASES))
    expected_stages = list(CORE_STAGES)
    results = []
    for release in releases:
        issues = []
        directory = directories.get(release, root / ("matlab-full100-" + release))
        if release not in directories:
            issue(issues, "artifact", "ci_summary:MissingRelease", "缺少版本产物 " + release, "pending")
        stages = read_stages(read_json(directory / "ci-stage-status.json", issues), release, issues)
        probe = summarize_probe(read_json(directory / "matlab-runtime-probe.json", issues), release, issues)
        evaluator = summarize_evaluator(read_json(directory / "evaluator-result.json", issues, optional=True), issues)
        postprocessing = summarize_postprocessing(directory, release, issues)
        expected_stages.extend(identifier for identifier in stages if identifier not in expected_stages)
        results.append({"release": release, "artifact_present": release in directories,
                        "stages": stages, "probe": probe, "evaluator": evaluator,
                        "postprocessing": postprocessing, "issues": issues})
    for result in results:
        stages = result["stages"]
        for identifier in expected_stages:
            if identifier not in stages:
                stages[identifier] = {"id": identifier, "status": "pending", "reported_status": None}
                issue(result["issues"], identifier, "ci_summary:MissingStage", "缺少阶段记录", "pending")
        result["stages"] = [stages[identifier] for identifier in expected_stages]
        statuses = [stage["status"] for stage in result["stages"]]
        result["stage_counts"] = counts(statuses)
        runtime_issues = [item["status"] for item in result["issues"]
                          if not item["source"].startswith(("evaluator-result.json", *POSTPROCESSING_FILES))]
        result["runtime_status"] = combined_status([*statuses, result["probe"]["status"], *runtime_issues])
        result["status"] = combined_status([
            result["runtime_status"], result["evaluator"]["status"],
            *([result["postprocessing"]["status"]] if result["postprocessing"]["sources"] else []),
            result["evaluator"]["visual_status"], *[item["status"] for item in result["issues"]],
        ])
        result["display_diagnostics"] = summarize_display_diagnostics(
            directories.get(result["release"], root / ("matlab-full100-" + result["release"])),
            result["release"])
    statuses = [result["status"] for result in results]
    return {"schema_version": 1, "input_root": str(root), "status": combined_status(statuses),
            "status_source": "local_artifact_evidence", "github_status": None,
            "expected_releases": list(RELEASES), "expected_stages": expected_stages,
            "stage_policy": "历史必需阶段与本次产物阶段 ID 的并集；缺失记 pending，不使用固定分母。",
            "release_counts": counts(statuses),
            "stage_counts": counts([stage["status"] for result in results for stage in result["stages"]]),
            "notice": NOTICE, "releases": results}


def markdown(summary: dict) -> str:
    def escaped(value: Any) -> str:
        return html.escape(first_line(value), quote=False).replace("|", "&#124;").replace("`", "&#96;")

    def count_text(values: dict) -> str:
        return "，".join(f"{status} {values[status]}" for status in STATUSES)

    lines = ["# MATLAB 三版本 CI 进度", "", f"总状态（本地证据推断）：{summary['status']}。",
             "版本：" + count_text(summary["release_counts"]) + "。",
             f"阶段（共 {summary['stage_counts']['total']}）：" + count_text(summary["stage_counts"]) + "。",
             "", summary["notice"], "", summary["stage_policy"], "",
             "| 版本 | CI 状态（本地推断） | 运行阶段/环境 | 探针 | passed | failed | pending | running | 后处理 | 评分器（原始分数） | 视觉审核记录 |",
             "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |"]
    for result in summary["releases"]:
        evaluator = result["evaluator"]
        score = (f"{evaluator['reported_score']}/{evaluator['maximum_score']}"
                 if evaluator["reported_score"] is not None else "未提供")
        row = [result["release"], result["status"], result["runtime_status"], result["probe"]["status"],
               *[result["stage_counts"][status] for status in STATUSES],
               result["postprocessing"]["status"] if result["postprocessing"]["sources"] else "未提供",
               f"{evaluator['status']} ({score})", evaluator["visual_status"]]
        lines.append("| " + " | ".join(escaped(value) for value in row) + " |")
    lines.extend(["", "## 阶段明细", "", "| 阶段 | " + " | ".join(
        escaped(result["release"]) for result in summary["releases"]) + " |",
        "| --- |" + " --- |" * len(summary["releases"])])
    for index, identifier in enumerate(summary["expected_stages"]):
        lines.append("| " + escaped(identifier) + " | " + " | ".join(
            result["stages"][index]["status"] for result in summary["releases"]) + " |")
    lines.extend(["", "## 错误与缺失", ""])
    for result in summary["releases"]:
        for item in result["issues"]:
            lines.append("- " + " / ".join(escaped(value) for value in (
                result["release"], item["source"], item["identifier"])) + ": " + escaped(item["message"]))
    if not any(result["issues"] for result in summary["releases"]):
        lines.append("无。")
    if any(result.get("display_diagnostics", {}).get("present") for result in summary["releases"]):
        labels = {"not_run": "未运行", "pending": "未运行", "running": "运行中",
                  "completed_pending_external_review": "完成待外部检查", "failed": "有失败",
                  "export_checks_completed": "回调 API 完成（待外部检查）"}
        lines.extend(["", "## 虚拟 DISPLAY 独立诊断", "",
                      "仅记录虚拟 DISPLAY 下三个 callback 的 API 完成状态；不计入主阶段分母、评分或总体门禁。"
                      "不代表视觉通过或桌面交互验证；缺少诊断包记未运行。", "",
                      "| 版本 | 诊断状态 | 报告 release | DISPLAY | publication 状态 / 错误 | native-pdf-page-probe 状态 / 错误 | vector-text-alignment-probe 状态 / 错误 |",
                      "| --- | --- | --- | --- | --- | --- | --- |"])
        for result in summary["releases"]:
            diagnostic = result["display_diagnostics"]
            row = [result["release"], labels[diagnostic["status"]],
                   diagnostic["reported_release"] or "未提供", diagnostic["display"] or "未提供"]
            for case in diagnostic["cases"]:
                detail = labels[case["status"]]
                if case["error_identifier"] or case["error_message"]:
                    detail += " / " + (case["error_identifier"] or "(无 identifier)") + ": " + case["error_message"]
                row.append(detail)
            lines.append("| " + " | ".join(escaped(value) for value in row) + " |")
        lines.append("")
        for result in summary["releases"]:
            for item in result["display_diagnostics"]["issues"]:
                lines.append("- 独立诊断 " + " / ".join(escaped(value) for value in (
                    result["release"], item["source"], item["identifier"])) + ": " + escaped(item["message"]))
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="离线汇总 MATLAB 三版本 CI；退出 0 仅表示汇总成功。")
    parser.add_argument("--input-root", type=Path, required=True, help="gh run download 产物根目录（只读）")
    parser.add_argument("--output-dir", type=Path, help="在输入目录之外写入 summary.md 和 summary.json")
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown", help="stdout 格式")
    arguments = parser.parse_args(argv)
    try:
        root = arguments.input_root.resolve()
        output = arguments.output_dir.resolve() if arguments.output_dir else None
        if output and any(path.resolve().is_relative_to(root) for path in (
                output, output / "summary.md", output / "summary.json")):
            raise ValueError("输出目录和输出文件不得位于输入目录内")
        summary = summarize(root)
        rendered = markdown(summary)
        encoded = json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        if output:
            output.mkdir(parents=True, exist_ok=True)
            (output / "summary.md").write_text(rendered, encoding="utf-8")
            (output / "summary.json").write_text(encoded, encoding="utf-8")
        print(encoded if arguments.format == "json" else rendered, end="")
    except (OSError, ValueError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
