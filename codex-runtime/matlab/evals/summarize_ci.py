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
CANVAS_REPORT = "canvas-extent-experiment/canvas-extent-experiment.json"
CANVAS_FILES = {
    "primary": "native-pdf-page-probe/" + CANVAS_REPORT,
    "display": "display-comparison/native-pdf-page-probe/" + CANVAS_REPORT,
}
CANVAS_CANDIDATES = ("panel-canvas-inset-0pt", "panel-canvas-inset-3pt")
CANVAS_GEOMETRY = ("geometry_before_pdf", "geometry_after_pdf", "geometry_after_png")
CANVAS_MAX_BYTES = 4 * 1024 * 1024
CANVAS_NOTICE = (
    "仅转述固定路径 JSON 的本地声明并检查声明一致性，不重跑 MATLAB；"
    "不读取逐候选文件，不独立核验文件哈希、字体、页面尺寸或视觉效果。"
    "诊断失败不改变主状态、阶段分母、原始评分或视觉审核；缺失记 not_run。"
)
NOTICE = (
    "CI 状态为本地证据推断，未提供 GitHub 状态、未查询远端，不重新验真。"
    "已知后处理失败优先于缺少视觉审核的 pending。运行阶段 passed 不代表 100 分或渲染/视觉通过；"
    "分数与视觉审核仅转述评分器，缺少证据为 pending。"
    "自动产物检查 passed 也不代表人工视觉审核通过。"
    "native-pdf-page-probe 的主阶段和 DISPLAY 回调只覆盖原三候选；"
    "canvas-extent-experiment 另表转述 primary/display 固定路径的补充实验声明。"
    + CANVAS_NOTICE +
    "缺失、失败或不完整实验不能从主阶段 passed 推断成功。"
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


def canvas_fields(record: Any, source: str, issues: list, strings: tuple,
                  booleans: tuple = ()) -> dict:
    if not isinstance(record, dict):
        issue(issues, source, "ci_summary:InvalidCanvasDeclaration", "诊断记录必须为对象")
        record = {}
    result = {}
    for keys, expected_type in ((strings, str), (booleans, bool)):
        for key in keys:
            value = record.get(key)
            if type(value) is not expected_type:
                issue(issues, source, "ci_summary:InvalidCanvasDeclaration", key + " 类型错误或缺失")
                value = None
            result[key] = first_line(value) if value is not None and (
                key.startswith("error_") or key == "inspection_error") else value
    return result


def canvas_errors(record: dict, source: str, issues: list, failed: bool = False) -> None:
    if failed or record.get("error_identifier") or record.get("error_message"):
        issue(issues, source, record.get("error_identifier") or "ci_summary:CanvasReportedFailure",
              record.get("error_message") or "本地声明失败，未提供错误消息")


def summarize_canvas_geometry(record: Any, source: str, issues: list) -> dict:
    if record == {}:
        return {"status": "not_run", "reported_status": None,
                "error_identifier": "", "error_message": ""}
    before = len(issues)
    result = canvas_fields(record, source, issues, ("status", "error_identifier", "error_message"))
    result["reported_status"] = result["status"]
    if result["status"] not in ("captured", "capture_failed"):
        issue(issues, source, "ci_summary:InvalidCanvasGeometry", "无效几何采集声明状态")
    canvas_errors(result, source, issues, result["status"] == "capture_failed")
    if len(issues) > before:
        result["status"] = "failed"
    return result


def summarize_canvas_artifact(record: Any, identifier: str, format_name: str,
                              source: str, issues: list) -> dict:
    before = len(issues)
    result = canvas_fields(record, source, issues, (
        "status", "file", "requested_api", "export_api", "export_object_class", "sha256",
        "inspection_status", "inspection_error", "error_identifier", "error_message",
    ), ("api_invoked", "export_call_succeeded", "file_exists", "pdf_header_present"))
    result["reported_status"] = result["status"]
    record = record if isinstance(record, dict) else {}
    size = record.get("bytes")
    result["bytes"] = size if type(size) is int and size >= 0 else None
    pixels = record.get("png_pixels")
    valid_pixels = (isinstance(pixels, list) and len(pixels) == 2
                    and all(type(value) is int and value > 0 for value in pixels))
    is_pdf = format_name == "pdf"
    expected_api = "exportgraphics" if is_pdf else "print"
    expected_file = identifier + ("/native.pdf" if is_pdf else "/native-reference.png")
    expected_request = "exportgraphics(panel, ContentType=vector)" if is_pdf else "print(figure, -dpng, -r300)"
    status = result["reported_status"]
    attempted = status in ("exported", "failed")
    dormant = status in ("not_attempted", "skipped", "not_attempted_setup_failed")
    if (not (attempted or dormant) or result["file"] != expected_file
            or result["requested_api"] != expected_request or result["bytes"] is None
            or (pixels != [] and not valid_pixels)):
        issue(issues, source, "ci_summary:InvalidCanvasArtifact", "无效产物状态、路径、调用声明或大小类型")
    if attempted:
        if (result["api_invoked"] is not True or result["export_api"] != expected_api
                or not result["export_object_class"]):
            issue(issues, source, "ci_summary:InconsistentCanvasArtifact", "已尝试状态与 API 调用声明不一致")
        inspection = result["inspection_status"]
        allowed_inspections = ("file_missing", "read_failed_external_check_required", *(
            ("literal_values_only_external_check_required", "no_literal_mediabox_external_check_required")
            if is_pdf else ("png_header_only_visual_check_required",)))
        if (inspection not in allowed_inspections
                or bool(result["inspection_error"]) != (inspection == "read_failed_external_check_required")
                or (result["file_exists"] is False and (
                    inspection != "file_missing" or result["bytes"] != 0 or result["sha256"]
                    or result["pdf_header_present"] or pixels != []))
                or (result["file_exists"] is True and inspection == "file_missing")):
            issue(issues, source, "ci_summary:InconsistentCanvasArtifact", "文件存在性与本地读取声明不一致")
        digest = result["sha256"]
        complete = (result["export_call_succeeded"] is True and result["file_exists"] is True
                    and result["bytes"] is not None and result["bytes"] > 0
                    and isinstance(digest, str) and len(digest) == 64
                    and all(character in "0123456789abcdefABCDEF" for character in digest)
                    and not result["inspection_error"]
                    and (result["pdf_header_present"] is True if is_pdf else valid_pixels))
        if (status == "exported") != complete:
            issue(issues, source, "ci_summary:InconsistentCanvasArtifact", "exported 与调用及文件声明不一致")
    elif dormant:
        if (any(result[key] is not False for key in (
                "api_invoked", "export_call_succeeded", "file_exists", "pdf_header_present"))
                or any(result[key] != "" for key in (
                    "export_api", "export_object_class", "sha256", "inspection_error"))
                or result["bytes"] != 0 or pixels != [] or result["inspection_status"] != "pending"):
            issue(issues, source, "ci_summary:InconsistentCanvasArtifact", "未尝试状态却带有调用或文件完成声明")
    canvas_errors(result, source, issues, status == "failed")
    if result["inspection_error"]:
        issue(issues, source, "ci_summary:CanvasInspectionError", result["inspection_error"])
    if len(issues) > before:
        result["status"] = "failed"
    return result


def summarize_canvas_candidate(record: dict, source: str, issues: list,
                               skip_reason: str) -> dict:
    before = len(issues)
    result = canvas_fields(record, source, issues, (
        "id", "status", "setup_status", "skip_reason", "error_identifier", "error_message"))
    result["reported_status"] = result["status"]
    for format_name in ("pdf", "png"):
        result[format_name] = summarize_canvas_artifact(
            record.get(format_name), result["id"], format_name, source + ":" + format_name, issues)
    for key in CANVAS_GEOMETRY:
        result[key] = summarize_canvas_geometry(record.get(key), source + ":" + key, issues)
    artifact_statuses = [result[key]["reported_status"] for key in ("pdf", "png")]
    geometry_statuses = [result[key]["reported_status"] for key in CANVAS_GEOMETRY]
    status, setup = result["reported_status"], result["setup_status"]
    if status in ("pending", "skipped"):
        expected_artifact = "not_attempted" if status == "pending" else "skipped"
        consistent = (setup == "pending" and artifact_statuses == [expected_artifact] * 2
                      and geometry_statuses == [None] * 3
                      and result["skip_reason"] == ("" if status == "pending" else skip_reason)
                      and (status != "skipped" or bool(skip_reason)))
    elif status in ("export_pair_completed", "failed"):
        finished_geometry = ("captured", "capture_failed")
        if setup == "failed":
            consistent = (artifact_statuses == ["not_attempted_setup_failed"] * 2
                          and geometry_statuses[0] in finished_geometry
                          and geometry_statuses[1:] == [None] * 2)
        else:
            consistent = (setup == "created" and not skip_reason
                          and all(value in ("exported", "failed") for value in artifact_statuses)
                          and all(value in finished_geometry for value in geometry_statuses))
        pair_completed = artifact_statuses == ["exported"] * 2 and geometry_statuses == ["captured"] * 3
        consistent = consistent and (status == "export_pair_completed") == pair_completed and not result["skip_reason"]
    else:
        consistent = False
    if not consistent:
        issue(issues, source, "ci_summary:InconsistentCanvasCandidate", "候选状态与 setup、调用、几何采集或跳过原因不一致")
    canvas_errors(result, source, issues, status == "failed" and len(issues) == before)
    if len(issues) > before:
        result["status"] = "failed"
    return result


def summarize_canvas_diagnostics(directory: Path, release: str, context: str) -> dict:
    source = CANVAS_FILES[context]
    issues: list = []
    result = {"context": context, "source": source, "present": False, "status": "not_run",
              "scope": "local_declarations_only", "counts_toward_stage": False,
              "reported_status": None, "release": release, "reported_release": None,
              "reported_summary": None, "candidates": [], "issues": issues}
    try:
        path = directory
        for component in ("", *Path(source).parts):
            path = path / component
            if path.is_symlink():
                raise ValueError("固定诊断路径不得含符号链接")
        if not path.exists():
            return result
        result["present"] = True
        if not path.is_file():
            raise ValueError("固定诊断路径必须是普通文件")
        with path.open("rb") as stream:
            raw = stream.read(CANVAS_MAX_BYTES + 1)
        if len(raw) > CANVAS_MAX_BYTES:
            raise ValueError("补充诊断 JSON 超出大小限制")
        payload = json.loads(raw.decode("utf-8"), parse_constant=reject_constant,
                             object_pairs_hook=unique_json_object)
        if not isinstance(payload, dict):
            raise ValueError("补充诊断 JSON 顶层必须为对象")
    except (OSError, UnicodeError, ValueError, RecursionError) as error:
        result.update(present=True, status="failed")
        issue(issues, source, "ci_summary:InvalidCanvasJSON", str(error))
        return result
    fields = canvas_fields(payload, source, issues, ("status", "release", "generated_at"),
                           ("font_available", "exportgraphics_available"))
    collect_errors(payload, source, issues)
    result.update(reported_status=fields["status"], reported_release=fields["release"])
    required = {"schema_version": 1, "release": release, "counts_toward_stage": False,
                "directory": "canvas-extent-experiment", "report_file": CANVAS_REPORT,
                "artifact_paths_relative_to": "experiment_directory",
                "scope": "native canvas extent diagnostic; not a production export strategy",
                "external_inspection_status": "pending", "exact_page_verified": False,
                "font_embedding_verified": False, "cjk_visual_verified": False,
                "text_extraction_verified": False, "layout_verified": False}
    for key, expected in required.items():
        if type(payload.get(key)) is not type(expected) or payload[key] != expected:
            issue(issues, source, "ci_summary:InvalidCanvasDeclaration", key + " 与补充诊断契约不符")
    if not fields["generated_at"]:
        issue(issues, source, "ci_summary:InvalidCanvasDeclaration", "缺少 generated_at")
    skip_reason = ("wenquanyi_not_confirmed_available" if fields["font_available"] is False
                   else "exportgraphics_unavailable" if fields["exportgraphics_available"] is False else "")
    records = payload.get("candidates")
    if not isinstance(records, list):
        issue(issues, source, "ci_summary:InvalidCanvasCandidates", "candidates 必须为两个候选的数组")
        records = []
    seen = set()
    for record in records:
        identifier = record.get("id") if isinstance(record, dict) else None
        if not isinstance(identifier, str) or identifier not in CANVAS_CANDIDATES or identifier in seen:
            issue(issues, source, "ci_summary:InvalidCanvasCandidates", "候选 id 未知、重复或缺失")
            continue
        seen.add(identifier)
        result["candidates"].append(summarize_canvas_candidate(
            record, source + ":" + identifier, issues, skip_reason))
    if seen != set(CANVAS_CANDIDATES):
        issue(issues, source, "ci_summary:InvalidCanvasCandidates", "未记录全部两个补充候选")
    statuses = [candidate["reported_status"] for candidate in result["candidates"]]
    status = fields["status"]
    if status in ("completed_diagnostics_only", "incomplete"):
        expected_counts = {"candidate_count": 2, "export_pairs_completed": statuses.count("export_pair_completed"),
                           "failed": statuses.count("failed"), "skipped": statuses.count("skipped")}
        summary = payload.get("summary")
        if isinstance(summary, dict):
            result["reported_summary"] = {
                key: value if type(value) in (int, bool, str) or (
                    type(value) is float and math.isfinite(value)) else None
                for key, value in ((key, summary.get(key)) for key in expected_counts)
            }
        if (not isinstance(summary, dict) or summary.keys() != expected_counts.keys()
                or any(type(summary.get(key)) is not int or summary[key] != value
                       for key, value in expected_counts.items())
                or any(value not in ("export_pair_completed", "failed", "skipped") for value in statuses)
                or (status == "completed_diagnostics_only") != (statuses == ["export_pair_completed"] * 2)):
            issue(issues, source, "ci_summary:InconsistentCanvasCounts", "完成状态、summary counts 与两个候选状态不一致")
        if not isinstance(payload.get("completed_at"), str) or not payload["completed_at"].strip():
            issue(issues, source, "ci_summary:InvalidCanvasDeclaration", "完成状态缺少 completed_at")
    elif status != "running" or any(key in payload for key in ("summary", "completed_at")):
        issue(issues, source, "ci_summary:InconsistentCanvasStatus", "未知状态或 running 带最终完成字段")
    result["status"] = "failed" if issues else ("pending" if status == "incomplete" else status)
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
        result["canvas_diagnostics"] = [summarize_canvas_diagnostics(
            directories.get(result["release"], root / ("matlab-full100-" + result["release"])),
            result["release"], context) for context in CANVAS_FILES]
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
    lines.extend(["", "## Canvas 补充独立诊断", "", CANVAS_NOTICE,
                  "JSON 未生成不代表未尝试；running 可能是最后保存的部分记录。"
                  "逐候选 candidate.json 和 stderr 不在本表读取范围内。", "",
                  "| 版本 | context | 诊断状态 / 原始声明 | 候选 / 原始状态 / setup | PDF 本地声明 | PNG 本地声明 | 几何采集本地声明 |",
                  "| --- | --- | --- | --- | --- | --- | --- |"])
    for result in summary["releases"]:
        for diagnostic in result["canvas_diagnostics"]:
            prefix = [result["release"], diagnostic["context"],
                      diagnostic["status"] + " / " + (diagnostic["reported_status"] or "未提供")]
            if not diagnostic["candidates"]:
                lines.append("| " + " | ".join(escaped(value) for value in [
                    *prefix, "未提供两个候选记录", "未提供", "未提供", "未提供"]) + " |")
            for candidate in diagnostic["candidates"]:
                row = [*prefix, " / ".join(str(candidate[key]) for key in (
                    "id", "reported_status", "setup_status"))]
                for format_name in ("pdf", "png"):
                    artifact = candidate[format_name]
                    row.append(" / ".join(str(artifact[key]) for key in ("reported_status", "export_api"))
                               + f"; invoked={artifact['api_invoked']}; call_succeeded={artifact['export_call_succeeded']}"
                               + f"; file_exists={artifact['file_exists']}; bytes={artifact['bytes']}"
                               + "; " + " / ".join(str(artifact[key] or "") for key in (
                                   "inspection_status", "inspection_error", "error_identifier", "error_message")))
                row.append("; ".join(key + "=" + str(candidate[key]["reported_status"] or candidate[key]["status"])
                                     + " / " + str(candidate[key]["error_identifier"] or "")
                                     + ": " + str(candidate[key]["error_message"] or "") for key in CANVAS_GEOMETRY))
                if candidate["skip_reason"]:
                    row[3] += " / " + candidate["skip_reason"]
                lines.append("| " + " | ".join(escaped(value) for value in row) + " |")
    lines.append("")
    for result in summary["releases"]:
        for diagnostic in result["canvas_diagnostics"]:
            for item in diagnostic["issues"]:
                lines.append("- Canvas 独立诊断 " + " / ".join(escaped(value) for value in (
                    result["release"], diagnostic["context"], item["source"], item["identifier"]))
                             + ": " + escaped(item["message"]))
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
