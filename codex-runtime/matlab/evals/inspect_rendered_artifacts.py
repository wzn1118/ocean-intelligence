#!/usr/bin/env python3
"""Inspect exported bytes, independently of MATLAB and the scoring evaluator.

Usage: python3 inspect_rendered_artifacts.py --manifest /run/figures.json \
    --artifact-root /run --output /run/artifact-evidence.json

The manifest uses figures (an array or MATLAB's singleton object), each with
an exports mapping keyed by png/pdf/svg. Records require file, bytes, sha256,
width and height; PDF dimensions are points, PNG/SVG dimensions are pixels.
Every supported file under the root is inspected; unlisted files fail coverage.
Missing Pillow or PDF tools never satisfies the corresponding check. No tools,
packages, fonts or images are downloaded. Output files must not already exist.
PDF text uses bounded pdftotext -bbox-layout output from the same byte snapshot.
Full normalized title/axis strings are text evidence, not a visibility verdict.
Missing Latin strings with mapped partial-text evidence fail; unavailable,
outlined, unmapped or otherwise ambiguous extraction remains not_verified.

Exit codes: 0 = automated checks passed, 1 = failed, 2 = not_verified (or CLI
usage error). Neither exit 0 nor this evidence replaces a human visual audit,
proves MATLAB execution/freshness, or verifies desktop interaction/CJK glyphs.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import io
import json
import math
import os
import re
import selectors
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import time
import unicodedata
import warnings
import xml.etree.ElementTree as ElementTree
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageChops, __version__ as PILLOW_VERSION
except ImportError:
    Image = ImageChops = None
    PILLOW_VERSION = None


FORMATS = {"png", "pdf", "svg"}
SVG_NAMESPACE = "http://www.w3.org/2000/svg"
MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_PNG_PIXELS = 40_000_000
MAX_PDF_PAGES = 1000
MAX_PDF_TEXT_BYTES = 1024 * 1024
MAX_EXPECTED_PDF_TEXTS = 128
MAX_EXPECTED_PDF_TEXT_LENGTH = 4096
PDF_TEXT_DOCTYPE = (b'<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" '
                    b'"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">')
XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml"
CJK_CHARACTER = r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0003134f]"
WHITE_THRESHOLD = 250
MIN_FOREGROUND_FRACTION = 0.001
ASPECT_RATIO_TOLERANCE = 0.005
NUMBER = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"


class InspectionError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise InspectionError(message)


def add_check(checks: list[dict[str, Any]], name: str, status: str,
              reason: str, **details: Any) -> None:
    checks.append({"name": name, "status": status, "reason": reason, **details})


def combined_status(items: list[dict[str, Any]]) -> str:
    statuses = {item["status"] for item in items}
    if not statuses or "failed" in statuses:
        return "failed"
    return "not_verified" if "not_verified" in statuses else "passed"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_regular_file(path: Path) -> bytes:
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode), f"regular, non-symlink file required: {path}")
    require(0 < info.st_size <= MAX_FILE_BYTES, f"empty or oversized file: {path}")
    with path.open("rb") as handle:
        data = handle.read(MAX_FILE_BYTES + 1)
    require(0 < len(data) <= MAX_FILE_BYTES, f"empty or oversized file: {path}")
    return data


def safe_artifact_path(root: Path, relative: str) -> Path:
    require(isinstance(relative, str) and bool(relative), "file must be nonempty text")
    require(not any(ord(character) < 32 for character in relative)
            and not any(character in relative for character in "\\:")
            and all(part not in {"", ".", ".."} for part in relative.split("/")),
            f"unsafe relative artifact path: {relative!r}")
    path = root
    for part in relative.split("/"):
        path = path / part
        require(not path.is_symlink(), f"symlink in artifact path: {relative}")
    require(path.resolve().is_relative_to(root), f"artifact escapes root: {relative}")
    return path


def positive_number(value: Any) -> bool:
    try:
        return (not isinstance(value, bool) and isinstance(value, (int, float))
                and math.isfinite(value) and value > 0)
    except OverflowError:
        return False


def compare_dimensions(checks: list[dict[str, Any]], name: str,
                       width: float, height: float,
                       record: dict[str, Any] | None, tolerance: float = 0) -> None:
    if record is None:
        return
    matches = (positive_number(record.get("width"))
               and positive_number(record.get("height"))
               and abs(record["width"] - width) <= tolerance
               and abs(record["height"] - height) <= tolerance)
    add_check(checks, name, "passed" if matches else "failed",
              "measured dimensions compared with manifest", width=width, height=height,
              expected_width=record.get("width"), expected_height=record.get("height"))


def inspect_png(data: bytes, record: dict[str, Any] | None,
                checks: list[dict[str, Any]]) -> None:
    require(len(data) >= 33 and data[:8] == b"\x89PNG\r\n\x1a\n"
            and data[8:16] == b"\x00\x00\x00\rIHDR", "invalid PNG IHDR")
    require(zlib.crc32(data[12:29]) == struct.unpack(">I", data[29:33])[0],
            "invalid PNG IHDR CRC")
    width, height = struct.unpack(">II", data[16:24])
    require(width > 0 and height > 0, "PNG dimensions must be positive")
    add_check(checks, "png_header", "passed", "PNG IHDR parsed", width=width, height=height)
    compare_dimensions(checks, "png_dimensions", width, height, record)
    if Image is None:
        add_check(checks, "png_pixels", "not_verified", "Pillow is not installed; pixels not decoded")
        return
    if width * height > MAX_PNG_PIXELS:
        add_check(checks, "png_pixels", "not_verified", "PNG exceeds decoding pixel limit")
        return
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as probe:
                require(probe.format == "PNG", "decoder did not identify PNG")
                probe.verify()
            with Image.open(io.BytesIO(data)) as decoded:
                require(getattr(decoded, "n_frames", 1) == 1, "animated PNG is not a static export")
                decoded.load()
                require(decoded.size == (width, height), "PNG decoded dimensions disagree with IHDR")
                rgba = decoded.convert("RGBA")
                composite = Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")
                extrema = composite.getextrema()
                red, green, blue = composite.split()
                histogram = ImageChops.darker(ImageChops.darker(red, green), blue).histogram()
                foreground_pixels = sum(histogram[:WHITE_THRESHOLD])
                foreground_fraction = foreground_pixels / (width * height)
                nonuniform = any(low != high for low, high in extrema)
                passed = nonuniform and foreground_fraction >= MIN_FOREGROUND_FRACTION
                add_check(checks, "png_pixels", "passed" if passed else "failed",
                          "all pixels decoded and alpha-composited on white; no visual-quality claim",
                          width=width, height=height, rgb_extrema=extrema,
                          nonuniform=nonuniform, foreground_pixels=foreground_pixels,
                          foreground_fraction=foreground_fraction)
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as error:
        add_check(checks, "png_pixels", "failed", f"PNG decoding failed: {error}")


def run_pdf_tool(name: str, executable: str | None, arguments: list[str],
                 timeout: float, checks: list[dict[str, Any]]) -> str | None:
    if executable is None:
        add_check(checks, name, "not_verified", f"system {name} is unavailable")
        return None
    command = [executable, *arguments]
    try:
        result = subprocess.run(command, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=timeout,
                                env={**os.environ, "LC_ALL": "C", "LANG": "C"})
    except (OSError, subprocess.TimeoutExpired) as error:
        add_check(checks, name, "not_verified", f"{name} could not complete: {error}")
        return None
    clean = result.returncode == 0 and not result.stderr.strip()
    add_check(checks, name, "passed" if clean else "failed",
              "system structural inspection of a hash-bound byte snapshot",
              command=command, returncode=result.returncode,
              stdout=result.stdout[:65536], stderr=result.stderr[:65536])
    return result.stdout if clean else None


def parse_pdfinfo(output: str, record: dict[str, Any] | None,
                  checks: list[dict[str, Any]]) -> None:
    count_match = re.search(r"^Pages:\s+(\d+)\s*$", output, re.MULTILINE)
    require(count_match is not None, "pdfinfo did not report page count")
    page_count = int(count_match.group(1))
    require(0 < page_count <= MAX_PDF_PAGES, "PDF page count outside inspection limit")
    require(re.search(r"^Encrypted:\s+no\s*$", output, re.MULTILINE) is not None,
            "encrypted or unknown-encryption PDF is not accepted")
    sizes = re.findall(rf"^Page\s+(\d+)\s+size:\s+({NUMBER})\s+x\s+({NUMBER})\s+pts\b",
                       output, re.MULTILINE)
    require(len(sizes) == page_count
            and {int(page) for page, _, _ in sizes} == set(range(1, page_count + 1)),
            "pdfinfo did not report every page size")
    dimensions = []
    for page, width, height in sizes:
        width_value, height_value = float(width), float(height)
        require(positive_number(width_value) and positive_number(height_value), "invalid PDF page size")
        dimensions.append({"page": int(page), "width_pt": width_value, "height_pt": height_value})
        compare_dimensions(checks, f"pdf_page_{page}_dimensions", width_value, height_value, record, 1.0)
    expected_pages = record.get("pages", 1) if record is not None else page_count
    require(isinstance(expected_pages, int) and not isinstance(expected_pages, bool)
            and expected_pages == page_count, "PDF page count differs from manifest (default: one page)")
    add_check(checks, "pdf_structure", "passed", "all PDF pages inspected by pdfinfo",
              page_count=page_count, page_dimensions=dimensions)


def parse_pdffonts(output: str, checks: list[dict[str, Any]]) -> None:
    lines = output.strip().splitlines()
    require(len(lines) >= 2 and lines[0].split() ==
            ["name", "type", "encoding", "emb", "sub", "uni", "object", "ID"]
            and re.fullmatch(r"[-\s]+", lines[1]) is not None, "unrecognized pdffonts table")
    fonts = []
    for line in lines[2:]:
        match = re.fullmatch(r"(\S+)\s+(.+?)\s+(\S+)\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+(\d+)\s+(\d+)\s*", line)
        require(match is not None, f"unrecognized pdffonts row: {line}")
        name, font_type, encoding, embedded, subset, unicode_map, object_id, generation = match.groups()
        fonts.append({"name": name, "type": font_type, "encoding": encoding,
                      "embedded": embedded, "subset": subset, "unicode_map": unicode_map,
                      "object_id": int(object_id), "generation": int(generation)})
    add_check(checks, "pdf_font_inventory", "passed", "pdffonts table parsed", fonts=fonts)
    status = "not_verified" if not fonts else ("passed" if all(font["embedded"] == "yes" for font in fonts) else "failed")
    add_check(checks, "pdf_font_embedding", status,
              "no fonts found; embedding cannot be verified" if not fonts else
              "embedding flags only; does not verify glyph appearance, CJK coverage or visual correctness")


def normalize_pdf_text(value: str) -> str:
    value = " ".join(unicodedata.normalize("NFKC", value).split())
    return re.sub(rf"(?<={CJK_CHARACTER})\s+(?={CJK_CHARACTER})", "", value)


def expected_pdf_texts(figure: dict[str, Any] | None) -> list[dict[str, Any]]:
    expected: dict[str, dict[str, Any]] = {}

    def collect(source: str, value: Any) -> None:
        if isinstance(value, list) and all(isinstance(part, str) for part in value):
            value = " ".join(value)
        require(isinstance(value, str), f"expected PDF text must be a string: {source}")
        require(len(value) <= MAX_EXPECTED_PDF_TEXT_LENGTH, "expected PDF text exceeds length limit")
        normalized = normalize_pdf_text(value)
        if normalized:
            item = expected.setdefault(normalized, {"expected": value, "normalized": normalized, "sources": []})
            item["sources"].append(source)
            require(len(item["sources"]) <= MAX_EXPECTED_PDF_TEXTS, "too many sources for expected PDF text")
        require(len(expected) <= MAX_EXPECTED_PDF_TEXTS, "too many expected PDF text strings")

    if figure is not None:
        collect("title", figure.get("title", ""))
        for field in ("axes", "axes_objects", "text_objects", "unmeasured_text_objects"):
            records = figure.get(field, [])
            if isinstance(records, dict):
                records = [records]
            require(isinstance(records, list), f"invalid PDF text metadata: {field}")
            require(len(records) <= MAX_EXPECTED_PDF_TEXTS, f"too many PDF text metadata records: {field}")
            for index, record in enumerate(records):
                require(isinstance(record, dict), f"invalid PDF text metadata: {field}[{index}]")
                if field in {"axes", "axes_objects"}:
                    for role in ("xlabel", "ylabel"):
                        collect(f"{field}[{index}].{role}", record.get(role, ""))
                elif record.get("role") in {"title", "xlabel", "ylabel", "layout.title", "layout.subtitle",
                                            "layout.xlabel", "layout.ylabel"}:
                    collect(f"{field}[{index}].string", record.get("string", ""))
    return list(expected.values())


def run_pdftotext(snapshot: Path, executable: str | None, timeout: float,
                  checks: list[dict[str, Any]], snapshot_hash: str) -> bytes | None:
    details: dict[str, Any] = {"snapshot_sha256": snapshot_hash}
    if executable is None:
        add_check(checks, "pdf_text_extractability", "not_verified", "system pdftotext is unavailable", **details)
        return None
    command = [executable, "-bbox-layout", "-enc", "UTF-8", "-f", "1", "-l", str(MAX_PDF_PAGES), str(snapshot), "-"]
    details["command"] = command
    streams = {"stdout": bytearray(), "stderr": bytearray()}
    problem = None
    try:
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env={**os.environ, "LC_ALL": "C", "LANG": "C"}) as process:
            try:
                deadline = time.monotonic() + timeout
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
                    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
                    while selector.get_map():
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise subprocess.TimeoutExpired(command, timeout)
                        for key, _ in selector.select(remaining):
                            total = sum(len(stream) for stream in streams.values())
                            chunk = os.read(key.fd, min(65536, MAX_PDF_TEXT_BYTES + 1 - total))
                            if not chunk:
                                selector.unregister(key.fileobj)
                                continue
                            streams[key.data].extend(chunk)
                            require(total + len(chunk) <= MAX_PDF_TEXT_BYTES, "pdftotext output limit exceeded")
                process.wait(timeout=max(0.001, deadline - time.monotonic()))
            except (InspectionError, subprocess.TimeoutExpired) as error:
                problem = "pdftotext timed out" if isinstance(error, subprocess.TimeoutExpired) else str(error)
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()
            details["returncode"] = process.returncode
    except OSError as error:
        problem = f"pdftotext could not complete: {error}"
    details.update(stdout_bytes=len(streams["stdout"]), stderr_bytes=len(streams["stderr"]),
                   stderr=bytes(streams["stderr"][:4096]).decode("utf-8", errors="replace"),
                   stderr_truncated=len(streams["stderr"]) > 4096)
    if problem or details.get("returncode") != 0 or streams["stderr"].strip():
        add_check(checks, "pdf_text_extractability", "not_verified",
                  problem or "pdftotext reported errors; extraction is not reliable", **details)
        return None
    output = bytes(streams["stdout"])
    details["bbox_output_sha256"] = sha256(output)
    add_check(checks, "pdftotext", "passed", "bounded extraction from the same PDF byte snapshot", **details)
    return output


class SafePDFTextBuilder(ElementTree.TreeBuilder):
    def doctype(self, name: str, public_id: str | None, system_id: str | None) -> None:
        raise InspectionError("PDF text XML DTD/entity declarations are not allowed")

    def pi(self, target: str, text: str | None = None) -> None:
        raise InspectionError("PDF text XML processing instructions are not allowed")


def parse_pdf_text(output: bytes) -> list[dict[str, Any]]:
    require(len(output) <= MAX_PDF_TEXT_BYTES, "pdftotext output limit exceeded")
    text = output.decode("utf-8")
    if output.startswith(PDF_TEXT_DOCTYPE):
        text = output[len(PDF_TEXT_DOCTYPE):].decode("utf-8")
    root = ElementTree.fromstring(text, parser=ElementTree.XMLParser(target=SafePDFTextBuilder()))
    namespace = "{" + XHTML_NAMESPACE + "}"
    require(root.tag == namespace + "html", "invalid PDF text XML root")
    children = {"html": {"head", "body"}, "head": {"title", "meta"}, "title": set(), "meta": set(),
                "body": {"doc"}, "doc": {"page"}, "page": {"flow"}, "flow": {"block"},
                "block": {"line"}, "line": {"word"}, "word": set()}
    for element in root.iter():
        tag = element.tag.removeprefix(namespace)
        require(element.tag.startswith(namespace) and tag in children, "unexpected PDF text XML element")
        require(all(child.tag in {namespace + name for name in children[tag]} for child in element),
                "invalid PDF text XML hierarchy")
        require(not any(local_name(name).lower() in {"href", "src", "base"} for name in element.attrib),
                "references in PDF text XML are not allowed")
    pages = root.findall(f"{namespace}body/{namespace}doc/{namespace}page")
    require(0 < len(pages) <= MAX_PDF_PAGES, "PDF text XML page count outside inspection limit")
    result = []
    for index, page in enumerate(pages, 1):
        require(all(positive_number(float(page.get(name, "nan"))) for name in ("width", "height")),
                "invalid PDF text page dimensions")
        words = list(page.iter(namespace + "word"))
        for word in words:
            bounds = [float(word.get(name, "nan")) for name in ("xMin", "yMin", "xMax", "yMax")]
            require(all(math.isfinite(value) for value in bounds) and bounds[2] >= bounds[0] and bounds[3] >= bounds[1],
                    "invalid PDF text word bounds")
        result.append({"page": index, "word_count": len(words),
                       "text": normalize_pdf_text(" ".join(word.text or "" for word in words))})
    return result


def pdf_text_contains(text: str, expected: str) -> bool:
    prefix = r"(?<!\w)" if expected[0].isascii() and expected[0].isalnum() else ""
    suffix = r"(?!\w)" if expected[-1].isascii() and expected[-1].isalnum() else ""
    return re.search(prefix + re.escape(expected) + suffix, text) is not None


def inspect_pdf_text(snapshot: Path, data: bytes, figure: dict[str, Any] | None,
                     checks: list[dict[str, Any]], executable: str | None, timeout: float) -> None:
    binding = {"snapshot_sha256": sha256(data)}
    output = run_pdftotext(snapshot, executable, timeout, checks, binding["snapshot_sha256"])
    pages = []
    try:
        expected = expected_pdf_texts(figure)
        if output is not None:
            pages = parse_pdf_text(output)
            binding["bbox_output_sha256"] = sha256(output)
            add_check(checks, "pdf_text_extractability", "passed" if any(page["text"] for page in pages) else "not_verified",
                      "PDF word text extracted; this does not verify visible glyphs or clipping", **binding,
                      pages=[{"page": page["page"], "word_count": page["word_count"],
                              "text_excerpt": page["text"][:4096], "excerpt_truncated": len(page["text"]) > 4096,
                              "normalized_text_sha256": sha256(page["text"].encode("utf-8"))} for page in pages])
    except (InspectionError, ElementTree.ParseError, UnicodeError, ValueError) as error:
        add_check(checks, "pdf_text_integrity", "failed", f"text evidence rejected: {error}", **binding)
        return
    fonts = next((check["fonts"] for check in checks
                  if check["name"] == "pdf_font_inventory" and check["status"] == "passed"), [])
    mapped = bool(fonts) and all(font["unicode_map"] == "yes" for font in fonts)
    reliable = mapped and not any(unicodedata.category(character) in {"Co", "Cc"} or character == "\ufffd"
                                  for page in pages for character in page["text"])
    labels = []
    for item in expected:
        normalized = item["normalized"]
        matches = [page["page"] for page in pages if pdf_text_contains(page["text"], normalized)]
        words = normalized.split()
        fragments = [" ".join(words[:2]), " ".join(words[-2:])] if len(words) > 2 else []
        partial = [{"page": page["page"], "fragment": fragment} for page in pages for fragment in fragments
                   if len(fragment) >= 8 and pdf_text_contains(page["text"], fragment)] if not matches else []
        status = "passed" if matches else ("failed" if normalized.isascii() and reliable and partial else "not_verified")
        labels.append({**item, "status": status, "matching_pages": matches, "partial_matches": partial,
                       "reason": "complete normalized text is extractable" if matches else
                       "mapped Latin text is only partially extractable; full expected string is absent" if status == "failed" else
                       "complete text not verified; outlining, mapping or extraction limitations cannot be excluded"})
    add_check(checks, "pdf_text_integrity", combined_status(labels) if labels else "not_verified",
              "expected title/axis text compared with extracted words; no visual or clipping-cause conclusion",
              **binding, normalization="NFKC; whitespace collapsed; CJK-to-CJK extraction gaps joined",
              word_order="pdftotext bbox-layout XML order, not coordinate sorting",
              all_fonts_have_unicode_maps=mapped, expected_count=len(labels), labels=labels)


def inspect_pdf(data: bytes, record: dict[str, Any] | None,
                checks: list[dict[str, Any]], dependencies: dict[str, Any], timeout: float,
                figure: dict[str, Any] | None = None) -> None:
    require(data.startswith(b"%PDF-"), "invalid PDF signature")
    with tempfile.TemporaryDirectory(prefix="inspect-pdf-") as directory:
        snapshot = Path(directory) / "artifact.pdf"
        snapshot.write_bytes(data)
        info = run_pdf_tool("pdfinfo", dependencies["pdfinfo"]["path"],
                            ["-box", "-f", "1", "-l", str(MAX_PDF_PAGES), str(snapshot)], timeout, checks)
        fonts = run_pdf_tool("pdffonts", dependencies["pdffonts"]["path"], [str(snapshot)], timeout, checks)
        for name, output, parser in (("pdf_structure", info, parse_pdfinfo),
                                     ("pdf_font_inventory", fonts, parse_pdffonts)):
            if output is not None:
                try:
                    if name == "pdf_structure":
                        parser(output, record, checks)
                    else:
                        parser(output, checks)
                except InspectionError as error:
                    add_check(checks, name, "failed", str(error))
        inspect_pdf_text(snapshot, data, figure, checks, dependencies.get("pdftotext", {}).get("path"), timeout)
        require(read_regular_file(snapshot) == data, "PDF tool snapshot changed during inspection")


class SafeSVGBuilder(ElementTree.TreeBuilder):
    def doctype(self, name: str, public_id: str | None, system_id: str | None) -> None:
        raise InspectionError("SVG DOCTYPE/entity declarations are not allowed")

    def pi(self, target: str, text: str | None = None) -> None:
        raise InspectionError("SVG processing instructions are not allowed")


def local_name(name: str) -> str:
    return name.rsplit("}", 1)[-1]


def svg_length(value: str) -> float:
    match = re.fullmatch(rf"\s*({NUMBER})(px|pt|pc|in|cm|mm)?\s*", value)
    require(match is not None, f"SVG length must be absolute: {value!r}")
    factors = {None: 1, "px": 1, "pt": 96 / 72, "pc": 16, "in": 96, "cm": 96 / 2.54, "mm": 96 / 25.4}
    length = float(match.group(1)) * factors[match.group(2)]
    require(positive_number(length), "SVG length must be finite and positive")
    return length


def svg_reference(value: str, identifiers: dict[str, Any], *, raster: bool = False) -> None:
    value = value.strip()
    if value.startswith("#"):
        require(value[1:] in identifiers, f"unresolved SVG fragment: {value}")
        return
    if raster:
        match = re.fullmatch(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)", value)
        if match:
            try:
                decoded = base64.b64decode("".join(match.group(2).split()), validate=True)
            except binascii.Error as error:
                raise InspectionError("invalid embedded raster base64") from error
            signature = b"\x89PNG\r\n\x1a\n" if match.group(1) == "png" else b"\xff\xd8\xff"
            require(decoded.startswith(signature), "embedded raster signature mismatch")
            return
    raise InspectionError(f"unsafe SVG reference: {value[:160]!r}")


def inspect_css(value: str, identifiers: dict[str, Any]) -> None:
    require(not any(token in value.lower() for token in
                    ("\\", "/*", "*/", "@", "expression", "behavior", "-moz-binding", "image-set")),
            "unsupported or unsafe SVG CSS syntax")
    require(not any(ord(character) < 32 and character not in "\t\r\n" for character in value),
            "control character in SVG CSS")
    functions = {name.lower() for name in re.findall(r"([\w-]+)\s*\(", value)}
    require(functions <= {"url", "rgb", "rgba", "hsl", "hsla", "matrix", "translate", "translatex",
                          "translatey", "scale", "scalex", "scaley", "rotate", "skew", "skewx", "skewy"},
            "unsupported SVG CSS function")
    references = list(re.finditer(r"url\s*\(([^()]*)\)", value, re.IGNORECASE))
    require(len(references) == len(re.findall(r"url\s*\(", value, re.IGNORECASE)),
            "malformed SVG CSS URL")
    for reference in references:
        target = reference.group(1).strip()
        if target.startswith(("'", '"')):
            require(len(target) >= 2 and target[-1] == target[0], "malformed quoted SVG URL")
            target = target[1:-1]
        svg_reference(target, identifiers)


def inspect_svg_references(root: Any) -> dict[str, Any]:
    identifiers = {}
    for element in root.iter():
        identifier = element.get("id")
        if identifier is not None:
            require(bool(identifier) and not re.search(r"\s", identifier), "invalid SVG id")
            require(identifier not in identifiers, f"duplicate SVG id: {identifier}")
            identifiers[identifier] = element
    forbidden = {"script", "foreignobject", "animate", "animatemotion", "animatetransform", "set", "discard", "handler"}
    for element in root.iter():
        tag = local_name(element.tag).lower()
        require(element.tag.startswith("{" + SVG_NAMESPACE + "}"), "foreign SVG element namespace")
        require(tag not in forbidden, f"active SVG element is not allowed: {tag}")
        if tag == "style":
            stylesheet = "".join(element.itertext())
            inspect_css(stylesheet, identifiers)
            require(not re.search(r"(?:^|[;{])\s*(?:width|height|inline-size|block-size)\s*:", stylesheet, re.IGNORECASE),
                    "stylesheet viewport overrides are not supported")
        for name, value in element.attrib.items():
            attribute = local_name(name).lower()
            require(not attribute.startswith("on") and attribute != "base", "active SVG attribute or base URI")
            if attribute in {"href", "src"}:
                svg_reference(value, identifiers, raster=(tag == "image" and attribute == "href"))
            elif attribute in {"aria-labelledby", "aria-describedby"}:
                require(bool(value.split()) and all(reference in identifiers for reference in value.split()),
                        f"unresolved {attribute}")
            elif attribute in {"style", "fill", "stroke", "filter", "clip-path", "mask", "cursor",
                               "marker", "marker-start", "marker-mid", "marker-end", "color-profile"} \
                    or re.search(r"url\s*\(", value, re.IGNORECASE):
                inspect_css(value, identifiers)
    return identifiers


def inspect_svg(data: bytes, record: dict[str, Any] | None,
                checks: list[dict[str, Any]]) -> None:
    root = ElementTree.fromstring(data, parser=ElementTree.XMLParser(target=SafeSVGBuilder()))
    require(root.tag == "{" + SVG_NAMESPACE + "}svg", "SVG namespace/root is invalid")
    add_check(checks, "svg_xml", "passed", "standard XML parser rejects duplicate attributes; DTD and PI disabled")
    try:
        identifiers = inspect_svg_references(root)
        add_check(checks, "svg_references", "passed", "only resolved local fragments or embedded PNG/JPEG image references; no active content")
    except InspectionError as error:
        identifiers = {}
        add_check(checks, "svg_references", "failed", str(error))
    try:
        width, height = svg_length(root.get("width", "")), svg_length(root.get("height", ""))
        coordinates = re.split(r"[\s,]+", root.get("viewBox", "").strip())
        require(len(coordinates) == 4 and all(re.fullmatch(NUMBER, value) for value in coordinates), "invalid SVG viewBox")
        viewbox = [float(value) for value in coordinates]
        require(all(math.isfinite(value) for value in viewbox) and min(viewbox[2:]) > 0,
                "SVG viewBox must have finite coordinates and positive extents")
        require(math.isclose(width / height, viewbox[2] / viewbox[3], rel_tol=ASPECT_RATIO_TOLERANCE),
                "SVG viewport/root viewBox aspect ratio mismatch")
        compare_dimensions(checks, "svg_dimensions", width, height, record, 0.001)
        if record is not None and any(key in record for key in ("viewbox_width", "viewbox_height")):
            require(all(positive_number(record.get(key)) and math.isclose(record[key], actual, rel_tol=1e-6, abs_tol=0.001)
                        for key, actual in zip(("viewbox_width", "viewbox_height"), viewbox[2:])),
                    "SVG root viewBox dimensions differ from manifest")
        declarations = {}
        for declaration in root.get("style", "").split(";"):
            if ":" in declaration:
                name, value = declaration.split(":", 1)
                declarations[name.strip().lower()] = value.strip()
        css_width = svg_length(declarations["width"]) if "width" in declarations else width
        css_height = svg_length(declarations["height"]) if "height" in declarations else height
        require(math.isclose(css_width / css_height, viewbox[2] / viewbox[3], rel_tol=ASPECT_RATIO_TOLERANCE),
                "SVG CSS viewport/root viewBox aspect ratio mismatch")
        physical_dimensions = (css_width / 96, css_height / 96)
        physical_attributes = ("data-physical-width-in", "data-physical-height-in")
        if any(name in root.attrib for name in physical_attributes):
            for name, measured in zip(physical_attributes, physical_dimensions):
                value = root.get(name, "")
                require(re.fullmatch(NUMBER, value) is not None and positive_number(float(value))
                        and math.isclose(float(value), measured, rel_tol=1e-6, abs_tol=1e-6),
                        f"SVG {name} differs from CSS physical viewport")
        physical_fields = ("physical_width_in", "physical_height_in")
        if record is not None and any(name in record for name in physical_fields):
            for name, measured in zip(physical_fields, physical_dimensions):
                require(positive_number(record.get(name))
                        and math.isclose(record[name], measured, rel_tol=1e-6, abs_tol=1e-6),
                        f"SVG manifest {name} differs from CSS physical viewport")
        add_check(checks, "svg_geometry", "passed", "absolute viewport and serialized root viewBox ratios agree",
                  width_px=width, height_px=height, native_viewbox=viewbox,
                  css_width_px=css_width, css_height_px=css_height,
                  physical_width_in=physical_dimensions[0], physical_height_in=physical_dimensions[1])
    except InspectionError as error:
        add_check(checks, "svg_geometry", "failed", str(error))
    try:
        text_values = {}
        for tag in ("title", "desc"):
            elements = root.findall("{" + SVG_NAMESPACE + "}" + tag)
            require(len(elements) == 1, f"SVG must have exactly one direct {tag}")
            text_values[tag] = " ".join("".join(elements[0].itertext()).split())
            require(bool(text_values[tag]), f"SVG {tag} must not be blank")
        require(root.get("aria-hidden", "false").lower() != "true"
                and root.get("role", "img") == "img", "SVG is hidden from accessibility or has a non-image role")
        require(root.get("display") != "none" and root.get("visibility") not in {"hidden", "collapse"}
                and not re.search(r"(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\b",
                                  root.get("style", ""), re.IGNORECASE), "SVG is hidden by presentation styling")
        for attribute in ("aria-labelledby", "aria-describedby"):
            if attribute in root.attrib:
                references = root.get(attribute).split()
                require(bool(references) and all(reference in identifiers and
                        "".join(identifiers[reference].itertext()).strip() for reference in references),
                        f"SVG {attribute} must resolve to nonempty text")
        require("aria-label" not in root.attrib or bool(root.get("aria-label").strip()), "blank SVG aria-label")
        if record is not None:
            for key, tag in (("title", "title"), ("description", "desc")):
                if key in record:
                    require(isinstance(record[key], str) and " ".join(record[key].split()) == text_values[tag],
                            f"SVG {tag} differs from manifest")
        add_check(checks, "svg_accessibility", "passed", "nonempty native title/desc and valid accessible-name references",
                  title=text_values["title"], description=text_values["desc"])
    except InspectionError as error:
        add_check(checks, "svg_accessibility", "failed", str(error))


def unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_json_constant(value: str) -> None:
    raise InspectionError(f"nonfinite JSON number: {value}")


def finite_json_float(value: str) -> float:
    result = float(value)
    require(math.isfinite(result), f"nonfinite JSON number: {value}")
    return result


def manifest_exports(manifest: Any, checks: list[dict[str, Any]]) -> list[tuple[str, str, dict[str, Any], dict[str, Any]]]:
    require(isinstance(manifest, dict) and type(manifest.get("schema_version")) is int
            and manifest["schema_version"] in {1, 2}, "manifest schema_version must be 1 or 2")
    figures = manifest.get("figures")
    if isinstance(figures, dict):
        figures = [figures]
    require(isinstance(figures, list) and bool(figures), "manifest figures must be nonempty")
    records = []
    identifiers = set()
    for index, figure in enumerate(figures):
        try:
            require(isinstance(figure, dict), f"figure {index} must be an object")
            identifier = figure.get("id")
            require(isinstance(identifier, str) and bool(identifier.strip()), f"figure {index} requires id")
            require(identifier not in identifiers, f"duplicate figure id: {identifier}")
            identifiers.add(identifier)
            exports = figure.get("exports")
            require(isinstance(exports, dict) and bool(exports), f"figure {identifier} requires exports")
            for format_name, record in exports.items():
                if format_name not in FORMATS or not isinstance(record, dict):
                    add_check(checks, "manifest_exports", "failed", f"unsupported export: {identifier}/{format_name}")
                    continue
                records.append((identifier, format_name, record, figure))
        except InspectionError as error:
            add_check(checks, "manifest_figures", "failed", str(error))
    require(bool(records), "manifest contains no supported exports")
    return records


def inspect_artifact(root: Path, relative: str, format_name: str, figure_id: str | None,
                     record: dict[str, Any] | None, dependencies: dict[str, Any],
                     timeout: float, figure: dict[str, Any] | None = None) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    result = {"file": relative, "format": format_name, "figure_id": figure_id, "checks": checks}
    try:
        path = safe_artifact_path(root, relative)
        require(path.suffix.lower() == "." + format_name, "artifact extension differs from manifest format")
        data = read_regular_file(path)
        result.update(bytes=len(data), sha256=sha256(data))
        if record is None:
            add_check(checks, "manifest_binding", "failed", "artifact is absent from manifest")
        else:
            expected_hash = record.get("sha256")
            matches = (type(record.get("bytes")) is int and record["bytes"] == len(data)
                       and isinstance(expected_hash, str) and re.fullmatch(r"[0-9a-fA-F]{64}", expected_hash) is not None
                       and expected_hash.lower() == result["sha256"])
            add_check(checks, "manifest_binding", "passed" if matches else "failed",
                      "artifact byte count and SHA-256 compared with manifest")
        if format_name == "png":
            inspect_png(data, record, checks)
        elif format_name == "pdf":
            inspect_pdf(data, record, checks, dependencies, timeout, figure)
        else:
            inspect_svg(data, record, checks)
    except (InspectionError, OSError, ElementTree.ParseError) as error:
        add_check(checks, "artifact_inspection", "failed", str(error))
    result["status"] = combined_status(checks)
    return result


def dependency_inventory() -> dict[str, Any]:
    dependencies = {"pillow": {"status": "available" if Image is not None else "not_verified", "version": PILLOW_VERSION}}
    for name in ("pdfinfo", "pdffonts", "pdftotext"):
        executable = shutil.which(name)
        dependencies[name] = {"status": "available" if executable else "not_verified", "path": executable}
    return dependencies


def inspect_rendered_artifacts(manifest_path: Path, artifact_root: Path,
                               *, pdf_timeout: float = 30) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    root = Path(artifact_root).resolve()
    manifest_path = Path(manifest_path).absolute()
    dependencies = dependency_inventory()
    evidence = {
        "schema_version": 1, "evidence_type": "automated_rendered_artifact_inspection",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "scope": "automated_artifact_checks_only",
        "limitations": "Automated artifact checks are NOT a human visual pass. PDF text evidence concerns extractability/integrity, not visibility or clipping cause. No score, MATLAB execution/freshness, desktop interaction, CJK glyph correctness or SVG/PDF visual-rendering approval is inferred.",
        "human_visual_inspection": "not_verified", "desktop_interaction": "not_verified",
        "cjk_glyph_rendering": "not_verified", "matlab_execution": "not_verified",
        "manifest": str(manifest_path), "artifact_root": str(root),
        "manifest_sha256": None, "inspector_sha256": sha256(Path(__file__).read_bytes()),
        "dependencies": dependencies,
        "policy": {"max_file_bytes": MAX_FILE_BYTES, "max_png_pixels": MAX_PNG_PIXELS,
                   "png_white_threshold": WHITE_THRESHOLD, "png_min_foreground_fraction": MIN_FOREGROUND_FRACTION,
                   "svg_ratio_relative_tolerance": ASPECT_RATIO_TOLERANCE,
                   "pdf_dimension_tolerance_pt": 1.0, "pdf_max_pages": MAX_PDF_PAGES,
                   "pdf_text_max_output_bytes": MAX_PDF_TEXT_BYTES,
                   "pdf_text_max_expected_strings": MAX_EXPECTED_PDF_TEXTS,
                   "pdf_text_max_expected_length": MAX_EXPECTED_PDF_TEXT_LENGTH,
                   "pdf_timeout_seconds": pdf_timeout},
        "checks": checks, "artifacts": artifacts,
    }
    try:
        require(positive_number(pdf_timeout), "PDF timeout must be positive and finite")
        require(root.is_dir(), "artifact root must be a directory")
        manifest_bytes = read_regular_file(manifest_path)
        evidence.update(manifest_sha256=sha256(manifest_bytes), manifest_bytes=len(manifest_bytes))
        manifest = json.loads(manifest_bytes, object_pairs_hook=unique_json_object,
                              parse_constant=reject_json_constant, parse_float=finite_json_float)
        records = manifest_exports(manifest, checks)
        declared = set()
        for figure_id, format_name, record, figure in records:
            relative = record.get("file")
            if not isinstance(relative, str):
                add_check(checks, "manifest_paths", "failed", f"non-text artifact file for {figure_id}/{format_name}")
                continue
            if relative in declared:
                add_check(checks, "manifest_paths", "failed", f"duplicate export file: {relative}")
                continue
            declared.add(relative)
            artifacts.append(inspect_artifact(root, relative, format_name, figure_id, record, dependencies, pdf_timeout, figure))

        def walk_error(error: OSError) -> None:
            raise error

        for directory, subdirectories, filenames in os.walk(root, followlinks=False, onerror=walk_error):
            subdirectories.sort()
            for name in subdirectories:
                if (Path(directory) / name).is_symlink():
                    add_check(checks, "root_inventory", "failed", f"symlink directory cannot be inventoried: {Path(directory) / name}")
            for name in sorted(filenames):
                path = Path(directory) / name
                format_name = path.suffix.lower().lstrip(".")
                relative = path.relative_to(root).as_posix()
                if format_name in FORMATS and relative not in declared:
                    artifacts.append(inspect_artifact(root, relative, format_name, None, None, dependencies, pdf_timeout))
        require(bool(artifacts), "no artifacts were inspected")
        for artifact in artifacts:
            if "sha256" not in artifact:
                continue
            try:
                current = read_regular_file(safe_artifact_path(root, artifact["file"]))
                require(sha256(current) == artifact["sha256"], "artifact changed during inspection")
                add_check(artifact["checks"], "stable_snapshot", "passed", "original bytes still match inspected snapshot")
            except (InspectionError, OSError) as error:
                add_check(artifact["checks"], "stable_snapshot", "failed", str(error))
            artifact["status"] = combined_status(artifact["checks"])
        require(sha256(read_regular_file(manifest_path)) == evidence["manifest_sha256"], "manifest changed during inspection")
        add_check(checks, "manifest_snapshot", "passed", "original manifest bytes still match inspected SHA-256")
    except (InspectionError, OSError, ValueError, UnicodeError, RecursionError) as error:
        add_check(checks, "input_validation", "failed", str(error))
    evidence["artifact_sha256"] = {artifact["file"]: artifact["sha256"] for artifact in artifacts if "sha256" in artifact}
    evidence["status"] = combined_status(checks + artifacts)
    evidence["summary"] = {status: sum(artifact["status"] == status for artifact in artifacts)
                           for status in ("passed", "failed", "not_verified")}
    evidence["summary"]["artifact_count"] = len(artifacts)
    return evidence


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--artifact-root", "--root", required=True, type=Path)
    parser.add_argument("--output", "--evidence", default="-", help="new evidence JSON file, or - for stdout")
    parser.add_argument("--pdf-timeout", type=float, default=30, help="seconds per PDF tool invocation")
    arguments = parser.parse_args(argv)
    if not positive_number(arguments.pdf_timeout):
        parser.error("--pdf-timeout must be positive and finite")
    evidence = inspect_rendered_artifacts(arguments.manifest, arguments.artifact_root, pdf_timeout=arguments.pdf_timeout)
    serialized = json.dumps(evidence, indent=2, ensure_ascii=True, allow_nan=False) + "\n"
    if arguments.output == "-":
        sys.stdout.write(serialized)
    else:
        try:
            with Path(arguments.output).open("x", encoding="utf-8") as handle:
                handle.write(serialized)
        except OSError as error:
            parser.exit(1, f"cannot create evidence file: {error}\n")
    return {"passed": 0, "failed": 1, "not_verified": 2}[evidence["status"]]


if __name__ == "__main__":
    sys.exit(main())
