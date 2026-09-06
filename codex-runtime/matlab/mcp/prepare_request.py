"""Validate dispatch bytes and finalize a licensed MATLAB execution receipt."""

import argparse
import base64
import binascii
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
from datetime import datetime, timezone
import uuid


RELEASES = ("R2021a", "R2024b", "R2026a")
CODE_LIMIT = 32768
INPUT_LIMIT = 16384
ARTIFACT_FILE_LIMIT = 128
ARTIFACT_BYTE_LIMIT = 16 * 1024 * 1024
ARTIFACT_TOTAL_LIMIT = 64 * 1024 * 1024
ARTIFACT_DIRECTORY_LIMIT = 128
METADATA_LIMIT = 1024 * 1024
SOURCE_FILES = (
    ".github/workflows/matlab-execute.yml",
    "codex-runtime/matlab/mcp/prepare_request.py",
    "codex-runtime/matlab/mcp/run_request.m",
)


class RequestError(ValueError):
    pass


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RequestError("JSON object contains a duplicate key")
        result[key] = value
    return result


def reject_constant(value):
    raise RequestError("JSON must not contain non-finite constants")


def strict_json(content):
    try:
        value = json.loads(content.decode("utf-8"), object_pairs_hook=no_duplicates,
                           parse_constant=reject_constant)
        pending = [value]
        while pending:
            current = pending.pop()
            if isinstance(current, dict):
                pending.extend(current.keys())
                pending.extend(current.values())
            elif isinstance(current, list):
                pending.extend(current)
            elif isinstance(current, str):
                current.encode("utf-8", errors="strict")
            elif isinstance(current, float) and not math.isfinite(current):
                raise RequestError("JSON numbers must be finite")
        return value
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
        raise RequestError("Invalid strict UTF-8 JSON") from error


def decode_base64(value, limit, label):
    if not isinstance(value, str) or not value or len(value) > 4 * ((limit + 2) // 3):
        raise RequestError(f"{label} is empty or exceeds its byte limit")
    try:
        content = base64.b64decode(value, validate=True)
        if base64.b64encode(content).decode("ascii") != value:
            raise RequestError(f"{label} must use canonical base64")
        content.decode("utf-8", errors="strict")
    except (UnicodeError, binascii.Error, ValueError) as error:
        raise RequestError(f"{label} must be strict base64 containing UTF-8") from error
    if not content or len(content) > limit:
        raise RequestError(f"{label} exceeds its decoded byte limit")
    return content


def validate_request(environ):
    request_id = environ.get("MATLAB_REQUEST_ID", "")
    try:
        if str(uuid.UUID(request_id)) != request_id.lower():
            raise ValueError("noncanonical UUID")
    except (ValueError, AttributeError) as error:
        raise RequestError("request_id must be a canonical hyphenated UUID") from error
    release = environ.get("MATLAB_REQUESTED_RELEASE", "")
    if release not in RELEASES:
        raise RequestError("Unsupported MATLAB release")
    code = decode_base64(environ.get("MATLAB_CODE_BASE64", ""), CODE_LIMIT, "code_base64")
    if b"\0" in code:
        raise RequestError("MATLAB code must not contain NUL bytes")
    claimed_hash = environ.get("MATLAB_CODE_SHA256", "")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", claimed_hash) or sha256(code) != claimed_hash.lower():
        raise RequestError("code_sha256 does not match the decoded bytes")
    encoded_input = environ.get("MATLAB_INPUT_JSON_BASE64", "")
    input_bytes = None
    if encoded_input:
        input_bytes = decode_base64(encoded_input, INPUT_LIMIT, "input_json_base64")
        strict_json(input_bytes)
    return {"request_id": request_id, "requested_release": release,
            "code_sha256": sha256(code), "code_bytes": len(code),
            "input_provided": input_bytes is not None,
            "input_sha256": sha256(input_bytes) if input_bytes is not None else "",
            "input_bytes": len(input_bytes) if input_bytes is not None else 0}, code, input_bytes


def regular_stat(path, limit=ARTIFACT_BYTE_LIMIT):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise RequestError(f"Expected a regular file without hard links: {path.name}")
    if before.st_size > limit:
        raise RequestError(f"File exceeds the {limit}-byte limit: {path.name}")
    return before


def regular_bytes(path, limit=ARTIFACT_BYTE_LIMIT):
    before = regular_stat(path, limit)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise RequestError("File changed while opening")
        if opened.st_size > limit:
            raise RequestError(f"File exceeds the {limit}-byte limit: {path.name}")
        content = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_size, after.st_mtime_ns, after.st_ctime_ns) or len(content) != after.st_size or len(content) > limit:
        raise RequestError("File changed while reading")
    return content


def file_record(path, relative):
    content = regular_bytes(path)
    return {"file": relative, "bytes": len(content), "sha256": sha256(content)}


def write_new(path, content):
    with path.open("xb") as stream:
        stream.write(content)


def write_json(path, payload):
    content = (json.dumps(payload, ensure_ascii=True, indent=2, allow_nan=False) + "\n").encode("utf-8")
    temporary = path.with_name(path.name + ".python-tmp")
    write_new(temporary, content)
    os.replace(temporary, path)


def empty_error():
    return {"identifier": "", "message": "", "stack": []}


def failed(receipt, identifier, message):
    receipt["status"] = "failed"
    receipt["finished_at"] = utc_now()
    receipt["error"] = {"identifier": identifier, "message": message, "stack": []}
    return receipt


def initial_receipt(environ):
    return {
        "schema_version": 1, "status": "prepared",
        "request_id": environ.get("MATLAB_REQUEST_ID", ""),
        "code_sha256": environ.get("MATLAB_CODE_SHA256", ""),
        "requested_release": environ.get("MATLAB_REQUESTED_RELEASE", ""),
        "matlab_release": "", "matlab_version": "",
        "ci_run_id": environ.get("GITHUB_RUN_ID", ""),
        "run_attempt": environ.get("GITHUB_RUN_ATTEMPT", ""),
        "commit": environ.get("GITHUB_SHA", ""),
        "prepared_at": utc_now(), "started_at": "", "finished_at": "",
        "matlab_started": False, "code_started": False, "code_completed": False,
        "error": empty_error(), "artifacts": [], "source_files": [],
        "installed_products": [], "toolbox_license_verified": False,
        "analysis_verified": False, "visual_verified": False,
        "source_hash_scope": "Request code and execution bootstrap, not all user-code dependencies",
        "artifact_limits": {"files": ARTIFACT_FILE_LIMIT, "file_bytes": ARTIFACT_BYTE_LIMIT,
                            "total_bytes": ARTIFACT_TOTAL_LIMIT, "directories": ARTIFACT_DIRECTORY_LIMIT,
                            "receipt_reserve_bytes": METADATA_LIMIT},
    }


def roots(environ):
    root = Path(environ["MATLAB_EXECUTION_ROOT"])
    artifact_root = Path(environ["MATLAB_ARTIFACT_ROOT"])
    if not root.is_absolute() or not artifact_root.is_absolute() or root == artifact_root:
        raise RequestError("Execution and artifact directories must be distinct absolute paths")
    if root in artifact_root.parents or artifact_root in root.parents:
        raise RequestError("Execution and artifact directories must not contain each other")
    return root, artifact_root


def prepare(environ):
    root, artifact_root = roots(environ)
    if os.path.lexists(root) or os.path.lexists(artifact_root):
        raise RequestError("Refusing to reuse an existing execution or artifact directory")
    root.mkdir()
    artifact_root.mkdir()
    receipt = initial_receipt(environ)
    artifact_name = "matlab-execution-invalid-request"
    try:
        if str(uuid.UUID(receipt["request_id"])) == receipt["request_id"].lower():
            artifact_name = "matlab-execution-" + receipt["request_id"]
    except ValueError:
        pass
    if environ.get("GITHUB_OUTPUT"):
        with Path(environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as stream:
            stream.write(f"created=true\nartifact_name={artifact_name}\n")
    write_json(root / "execution.json", receipt)
    write_new(root / "diary.log", b"")
    try:
        metadata, code, input_bytes = validate_request(environ)
        for name in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
            if not re.fullmatch(r"[1-9][0-9]*", environ.get(name, "")):
                raise RequestError(f"{name} must identify the actual CI run")
        if not re.fullmatch(r"[0-9a-fA-F]{40}", receipt["commit"]):
            raise RequestError("GITHUB_SHA must be a commit SHA")
        project = Path(environ["MATLAB_PROJECT_ROOT"]).resolve(strict=True)
        sources = [file_record(project / relative, relative) for relative in SOURCE_FILES]
        receipt.update({key: metadata[key] for key in ("request_id", "requested_release", "code_sha256")})
        receipt["source_files"] = sources
        metadata.update({key: receipt[key] for key in ("ci_run_id", "run_attempt", "commit", "prepared_at")})
        metadata["source_files"] = sources
        outputs = root / "outputs"
        outputs.mkdir()
        write_new(root / "code.m", code)
        write_new(outputs / "request_code.m", code)
        if input_bytes is not None:
            write_new(root / "input.json", input_bytes)
            write_new(outputs / "input.json", input_bytes)
        write_json(root / "request.json", metadata)
        write_json(root / "execution.json", receipt)
    except (RequestError, OSError, KeyError, ValueError) as error:
        failed(receipt, "MATLABExecution:InvalidRequest", str(error))
        write_json(root / "execution.json", receipt)
        write_json(artifact_root / "execution.json", receipt)
        write_new(artifact_root / "diary.log", b"")
        raise
    return receipt


def validate_result(receipt, request, environ, root):
    if not isinstance(request, dict) or type(receipt.get("schema_version")) is not int or receipt["schema_version"] != 1:
        raise RequestError("Invalid execution metadata schema")
    for field in ("request_id", "requested_release", "code_sha256", "ci_run_id", "run_attempt", "commit"):
        if receipt.get(field) != request[field]:
            raise RequestError(f"Receipt identity mismatch: {field}")
    for field, name in (("requested_release", "MATLAB_REQUESTED_RELEASE"), ("ci_run_id", "GITHUB_RUN_ID"),
                        ("run_attempt", "GITHUB_RUN_ATTEMPT"), ("commit", "GITHUB_SHA")):
        if request[field] != environ.get(name):
            raise RequestError(f"Request differs from the CI environment: {field}")
    for relative in ("code.m", "outputs/request_code.m"):
        content = regular_bytes(root / relative, CODE_LIMIT)
        if len(content) != request["code_bytes"] or sha256(content) != request["code_sha256"]:
            raise RequestError("Request code changed after preparation")
    if request["input_provided"]:
        for relative in ("input.json", "outputs/input.json"):
            content = regular_bytes(root / relative, INPUT_LIMIT)
            if len(content) != request["input_bytes"] or sha256(content) != request["input_sha256"]:
                raise RequestError("Input JSON changed after preparation")
    project = Path(environ["MATLAB_PROJECT_ROOT"])
    if request["source_files"] != [file_record(project / relative, relative) for relative in SOURCE_FILES]:
        raise RequestError("Execution bootstrap source changed")
    if receipt.get("source_files") != request["source_files"]:
        raise RequestError("Receipt source hashes differ from the prepared request")
    if receipt.get("status") == "succeeded":
        if environ.get("MATLAB_STEP_OUTCOME") != "success":
            raise RequestError("MATLAB step did not succeed")
        for key in ("matlab_started", "code_started", "code_completed"):
            if receipt.get(key) is not True:
                raise RequestError("MATLAB completion evidence is missing")
        if receipt.get("matlab_release") != request["requested_release"]:
            raise RequestError("Actual MATLAB release does not match the request")
        if not isinstance(receipt.get("matlab_version"), str) or not receipt["matlab_version"]:
            raise RequestError("Actual MATLAB version is missing")
        timestamps = []
        for key in ("started_at", "finished_at"):
            value = receipt.get(key)
            if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", value):
                raise RequestError("MATLAB timestamps must be UTC")
            timestamps.append(datetime.fromisoformat(value[:-1] + "+00:00"))
        if timestamps[1] < timestamps[0]:
            raise RequestError("MATLAB finish precedes start")
        if receipt.get("error") != empty_error():
            raise RequestError("Successful execution cannot contain an error")
    elif receipt.get("status") != "failed":
        raise RequestError("MATLAB did not finish; startup failure, termination or timeout is possible")


def collect_outputs(root, available_files, available_bytes):
    paths = []
    directories = 0
    outputs = root / "outputs"
    if outputs.exists() or outputs.is_symlink():
        if outputs.is_symlink() or not outputs.is_dir():
            raise RequestError("outputs must be a real directory")
        def walk_error(error):
            raise error

        for directory, children, files in os.walk(outputs, followlinks=False, onerror=walk_error):
            directories += 1
            if directories > ARTIFACT_DIRECTORY_LIMIT:
                raise RequestError("Output archive exceeds its directory-count limit")
            for child in children:
                if (Path(directory) / child).is_symlink():
                    raise RequestError("Output directory symlinks are not archived")
            for filename in files:
                if len(paths) >= available_files:
                    raise RequestError("Output archive exceeds its file-count limit")
                path = Path(directory) / filename
                size = regular_stat(path).st_size
                available_bytes -= size
                if available_bytes < 0:
                    raise RequestError("Output archive exceeds its total-byte limit")
                paths.append(path)
    return sorted(paths)


def validate_artifact_path(relative):
    parts = relative.split("/")
    if (len(relative.encode("utf-8")) > 2048 or len(parts) > 16
            or any(not part or part in (".", "..") or len(part.encode("utf-8")) > 255 for part in parts)
            or any(ord(character) < 32 or ord(character) == 127 for character in relative)
            or "\\" in relative or ":" in relative):
        raise RequestError("Output path is not portable or exceeds archive path limits")


def finalize(environ):
    root, artifact_root = roots(environ)
    receipt = initial_receipt(environ)
    try:
        receipt = strict_json(regular_bytes(root / "execution.json", METADATA_LIMIT))
        if not isinstance(receipt, dict):
            raise RequestError("Execution receipt must be an object")
        if (root / "request.json").exists():
            request = strict_json(regular_bytes(root / "request.json", METADATA_LIMIT))
            validate_result(receipt, request, environ, root)
        elif receipt.get("status") != "failed":
            raise RequestError("No validated request exists")
    except (RequestError, OSError, ValueError, KeyError, TypeError) as error:
        if not isinstance(receipt, dict):
            receipt = initial_receipt(environ)
        failed(receipt, "MATLABExecution:IncompleteOrInvalid", str(error))
    receipt["analysis_verified"] = False
    receipt["visual_verified"] = False
    receipt["toolbox_license_verified"] = False
    receipt["matlab_step_outcome"] = environ.get("MATLAB_STEP_OUTCOME", "not_available")
    receipt["artifacts"] = []
    copied_files = 1
    copied_bytes = METADATA_LIMIT

    def archive_file(path):
        nonlocal copied_files, copied_bytes
        if copied_files >= ARTIFACT_FILE_LIMIT:
            raise RequestError("Output archive exceeds its file-count limit")
        relative = path.relative_to(root).as_posix()
        validate_artifact_path(relative)
        limit = min(ARTIFACT_BYTE_LIMIT, ARTIFACT_TOTAL_LIMIT - copied_bytes)
        content = regular_bytes(path, limit)
        destination = artifact_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if os.path.lexists(destination):
            if relative != "diary.log" or regular_stat(destination).st_size != 0:
                raise RequestError("Refusing to overwrite an existing archived output")
            destination.unlink()
        write_new(destination, content)
        copied_files += 1
        copied_bytes += len(content)
        receipt["artifacts"].append({"file": relative, "bytes": len(content), "sha256": sha256(content)})

    paths = [root / "diary.log"]
    paths += [root / name for name in ("code.m", "input.json", "display.log", "request.json")
              if os.path.lexists(root / name)]
    for path in paths:
        try:
            archive_file(path)
            if path.name == "diary.log":
                receipt["diary_capture"] = {"status": "archived", "reason": ""}
        except (RequestError, OSError, ValueError) as error:
            failed(receipt, "MATLABExecution:ArtifactCollection", str(error))
            if path.name == "diary.log":
                receipt["diary_capture"] = {"status": "not_archived", "reason": str(error)}
                destination = artifact_root / "diary.log"
                if not os.path.lexists(destination):
                    write_new(destination, b"")
                    copied_files += 1
                if regular_stat(destination).st_size == 0:
                    receipt["artifacts"].append({"file": "diary.log", "bytes": 0, "sha256": sha256(b"")})
    try:
        paths = collect_outputs(root, ARTIFACT_FILE_LIMIT - copied_files, ARTIFACT_TOTAL_LIMIT - copied_bytes)
        for path in paths:
            archive_file(path)
    except (RequestError, OSError, ValueError) as error:
        failed(receipt, "MATLABExecution:ArtifactCollection", str(error))
    if receipt.get("status") not in ("succeeded", "failed"):
        failed(receipt, "MATLABExecution:Incomplete", "No completed MATLAB execution")
    if not receipt.get("finished_at"):
        receipt["finished_at"] = utc_now()
    write_json(root / "execution.json", receipt)
    write_json(artifact_root / "execution.json", receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "finalize"))
    options = parser.parse_args()
    try:
        receipt = prepare(os.environ) if options.mode == "prepare" else finalize(os.environ)
    except (RequestError, OSError, ValueError, KeyError) as error:
        print(f"MATLAB_EXECUTION_ERROR={error}", file=sys.stderr)
        return 1
    print("MATLAB_EXECUTION_STATUS=" + receipt["status"])
    return 1 if receipt["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
