"""Independent tests using local synthetic bytes, never downloaded/MATLAB evidence."""
from __future__ import annotations

import base64
import copy
import importlib.util
import json
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ElementTree
import zlib
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "inspect_rendered_artifacts.py"
SPEC = importlib.util.spec_from_file_location("rendered_artifacts", MODULE_PATH)
assert SPEC and SPEC.loader
inspector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inspector)


def png_bytes(width: int = 40, height: int = 24, *, color: tuple[int, ...] | None = None) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    rows = []
    for row in range(height):
        pixels = bytearray()
        for column in range(width):
            pixel = color if color is not None else ((20, 80, 120, 255) if column < width // 2 else (255, 255, 255, 255))
            pixels.extend(pixel)
        rows.append(b"\x00" + bytes(pixels))
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b""))


def svg_bytes() -> bytes:
    return b'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="120px" height="60px" viewBox="10 20 240 120"
     style="width:1.25in;height:0.625in" role="img"
     aria-labelledby="title" aria-describedby="description">
  <title id="title">Synthetic &amp; local</title>
  <desc id="description">A local test fixture, not observed data.</desc>
  <defs><clipPath id="clip"><rect width="240" height="120"/></clipPath></defs>
  <path id="shape" d="M10 20 L250 140" stroke="black" clip-path="url(#clip)"/>
  <use xlink:href="#shape"/>
</svg>'''


def pdf_bytes(*, font: str = "embedded", sizes: tuple[tuple[int, int], ...] = ((120, 60),)) -> bytes:
    def stream(content: bytes) -> bytes:
        return b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream"

    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b""]
    if font == "embedded":
        objects.append(b"<< /Type /Font /Subtype /Type3 /Name /F1 /FontBBox [0 0 600 700] "
                       b"/FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /A 4 0 R >> "
                       b"/Encoding << /Type /Encoding /Differences [65 /A] >> "
                       b"/FirstChar 65 /LastChar 65 /Widths [600] /Resources << >> >>")
        objects.append(stream(b"600 0 0 0 600 700 d1\n0 0 600 700 re f"))
    else:
        objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids = []
    for width, height in sizes:
        page_id = len(objects) + 1
        page_ids.append(page_id)
        resources = "/Font << /F1 3 0 R >>" if font != "none" else ""
        objects.append((f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
                        f"/Resources << {resources} >> /Contents {page_id + 1} 0 R >>").encode())
        content = b"BT /F1 12 Tf 20 20 Td (A) Tj ET" if font != "none" else b"0 0 20 20 re f"
        objects.append(stream(content))
    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects[1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode()
    result = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, content in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{index} 0 obj\n".encode() + content + b"\nendobj\n")
    xref = len(result)
    result.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode())
    result.extend((f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\n"
                   f"startxref\n{xref}\n%%EOF\n").encode())
    return bytes(result)


class ArtifactTestCase(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="rendered-artifact-tests-")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.root = self.directory / "artifacts"
        self.root.mkdir()
        self.manifest = self.root / "figures.json"

    def artifact(self, name: str, data: bytes, width: int = 120, height: int = 60, **metadata: object) -> dict:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return {"file": name, "bytes": len(data), "sha256": inspector.sha256(data),
                "width": width, "height": height, **metadata}

    def write_manifest(self, exports: dict, *, singleton: bool = False) -> dict:
        figure = {"id": "synthetic", "title": "A", "exports": exports}
        payload = {"schema_version": 2, "figures": figure if singleton else [figure]}
        self.manifest.write_text(json.dumps(payload), encoding="utf-8")
        return payload

    def inspect(self) -> dict:
        return inspector.inspect_rendered_artifacts(self.manifest, self.root)

    def find_check(self, evidence: dict, name: str, index: int = 0) -> dict:
        return next(check for check in evidence["artifacts"][index]["checks"] if check["name"] == name)


class ManifestAndEvidenceTests(ArtifactTestCase):
    def test_real_bytes_bound_to_manifest_and_inspector_hashes(self) -> None:
        record = self.artifact("figure.svg", svg_bytes(), viewbox_width=240, viewbox_height=120)
        payload = self.write_manifest({"svg": record}, singleton=True)
        payload.update(score=100, desktop=True, cjk=True, visual_inspection_verified=True)
        self.manifest.write_text(json.dumps(payload), encoding="utf-8")
        evidence = self.inspect()
        self.assertEqual(evidence["status"], "passed")
        self.assertEqual(evidence["manifest_sha256"], inspector.sha256(self.manifest.read_bytes()))
        self.assertEqual(evidence["inspector_sha256"], inspector.sha256(MODULE_PATH.read_bytes()))
        self.assertEqual(evidence["artifact_sha256"], {"figure.svg": record["sha256"]})
        for name in ("score", "desktop", "cjk", "visual_inspection_verified"):
            self.assertNotIn(name, evidence)
        for name in ("human_visual_inspection", "desktop_interaction", "cjk_glyph_rendering", "matlab_execution"):
            self.assertEqual(evidence[name], "not_verified")
        self.assertIn("NOT a human visual pass", evidence["limitations"])
        json.dumps(evidence, allow_nan=False)

    def test_hash_bytes_and_geometry_are_not_trusted(self) -> None:
        record = self.artifact("figure.svg", svg_bytes())
        for field, value, check in (("sha256", "0" * 64, "manifest_binding"),
                                    ("bytes", 1, "manifest_binding"),
                                    ("width", 999, "svg_dimensions"),
                                    ("height", True, "svg_dimensions"),
                                    ("width", 10 ** 400, "svg_dimensions")):
            with self.subTest(field=field, value=str(value)[:30]):
                altered = {**record, field: value}
                self.write_manifest({"svg": altered})
                evidence = self.inspect()
                self.assertEqual(evidence["status"], "failed")
                self.assertEqual(self.find_check(evidence, check)["status"], "failed")

    def test_invalid_manifests_fail_without_successful_empty_check(self) -> None:
        for raw in ("{}", '{"schema_version":2,"figures":[]}',
                    '{"schema_version":2,"schema_version":2,"figures":[]}',
                    '{"schema_version":2,"figures":{},"claim":NaN}',
                    '{"schema_version":2,"figures":{},"claim":1e999}',
                    '{"schema_version":2,"figures":[{"id":"x","exports":{}}]}',
                    '{"schema_version":2,"figures":[{"id":"x","exports":{"gif":{}}}]}',
                    "not JSON"):
            with self.subTest(raw=raw):
                self.manifest.write_text(raw, encoding="utf-8")
                evidence = self.inspect()
                self.assertEqual(evidence["status"], "failed")
                json.dumps(evidence, allow_nan=False)

    def test_duplicate_figures_and_paths_fail(self) -> None:
        record = self.artifact("figure.svg", svg_bytes())
        payload = self.write_manifest({"svg": record})
        for same_id in (True, False):
            altered = copy.deepcopy(payload)
            duplicate = copy.deepcopy(altered["figures"][0])
            if not same_id:
                duplicate["id"] = "other"
            altered["figures"].append(duplicate)
            self.manifest.write_text(json.dumps(altered), encoding="utf-8")
            self.assertEqual(self.inspect()["status"], "failed")

    def test_paths_cannot_escape_root_or_use_symlinks(self) -> None:
        record = self.artifact("figure.svg", svg_bytes())
        for relative in ("../outside.svg", "/tmp/outside.svg", "file:///tmp/outside.svg", "C:/outside.svg",
                         "nested/../figure.svg", "nested\\figure.svg", "./figure.svg", "nested//figure.svg", "bad\x00.svg"):
            with self.subTest(relative=relative):
                self.write_manifest({"svg": {**record, "file": relative}})
                evidence = self.inspect()
                self.assertEqual(evidence["status"], "failed")
                self.assertNotIn("sha256", evidence["artifacts"][0])
        outside = self.directory / "outside"
        outside.mkdir()
        (outside / "figure.svg").write_bytes(svg_bytes())
        (self.root / "linked").symlink_to(outside, target_is_directory=True)
        (self.root / "linked.svg").symlink_to(outside / "figure.svg")
        for relative in ("linked/figure.svg", "linked.svg"):
            self.write_manifest({"svg": {**record, "file": relative}})
            evidence = self.inspect()
            self.assertEqual(evidence["status"], "failed")
            self.assertNotIn("sha256", evidence["artifacts"][0])

    def test_missing_empty_and_wrong_extension_artifacts_fail(self) -> None:
        record = self.artifact("figure.svg", svg_bytes())
        self.write_manifest({"svg": {**record, "file": "missing.svg"}})
        self.assertEqual(self.inspect()["status"], "failed")
        self.write_manifest({"svg": record})
        (self.root / "figure.svg").write_bytes(b"")
        self.assertEqual(self.inspect()["status"], "failed")
        self.write_manifest({"png": record})
        self.assertEqual(self.inspect()["status"], "failed")

    def test_unlisted_pngs_are_also_inspected(self) -> None:
        self.write_manifest({"svg": self.artifact("figure.svg", svg_bytes())})
        self.artifact("nested/extra.PNG", png_bytes(), 40, 24)
        evidence = self.inspect()
        self.assertEqual(evidence["status"], "failed")
        self.assertEqual(evidence["summary"]["artifact_count"], 2)
        self.assertEqual(evidence["artifacts"][1]["file"], "nested/extra.PNG")
        self.assertEqual(self.find_check(evidence, "png_header", 1)["status"], "passed")

    def test_mutation_during_inspection_invalidates_hash_binding(self) -> None:
        record = self.artifact("figure.svg", svg_bytes())
        original = inspector.inspect_svg
        for target in (self.manifest, self.root / "figure.svg"):
            self.write_manifest({"svg": record})
            (self.root / "figure.svg").write_bytes(svg_bytes())

            def mutate(data: bytes, metadata: dict, checks: list) -> None:
                original(data, metadata, checks)
                target.write_bytes(target.read_bytes() + b"\n")

            with self.subTest(target=target), mock.patch.object(inspector, "inspect_svg", side_effect=mutate):
                evidence = self.inspect()
            self.assertEqual(evidence["status"], "failed")
            self.assertIn("changed during inspection", json.dumps(evidence))


class PNGTests(ArtifactTestCase):
    def test_missing_pillow_reports_dimensions_but_pixels_not_verified(self) -> None:
        self.write_manifest({"png": self.artifact("figure.png", png_bytes(), 40, 24)})
        with mock.patch.object(inspector, "Image", None):
            evidence = self.inspect()
        self.assertEqual(evidence["status"], "not_verified")
        self.assertEqual(self.find_check(evidence, "png_dimensions")["status"], "passed")
        self.assertEqual(self.find_check(evidence, "png_pixels")["status"], "not_verified")

    def test_dimension_mismatch_fails_even_without_pillow(self) -> None:
        self.write_manifest({"png": self.artifact("figure.png", png_bytes(), 41, 24)})
        with mock.patch.object(inspector, "Image", None):
            evidence = self.inspect()
        self.assertEqual(evidence["status"], "failed")
        self.assertEqual(self.find_check(evidence, "png_dimensions")["status"], "failed")

    def test_invalid_png_header_or_crc_fails_without_pillow(self) -> None:
        corrupted = bytearray(png_bytes())
        corrupted[32] ^= 1
        for data in (b"fake PNG", bytes(corrupted)):
            self.write_manifest({"png": self.artifact("figure.png", data, 40, 24)})
            with mock.patch.object(inspector, "Image", None):
                self.assertEqual(self.inspect()["status"], "failed")

    @unittest.skipIf(inspector.Image is None, "Pillow unavailable: real pixel decoding not verified")
    def test_nonblank_rgba_palette_and_rgb_decode(self) -> None:
        for mode in ("RGBA", "RGB", "P", "L"):
            with self.subTest(mode=mode):
                record = self.artifact("figure.png", png_bytes(), 40, 24)
                with inspector.Image.open(self.root / "figure.png") as image:
                    converted = image.convert(mode)
                converted.save(self.root / "figure.png")
                data = (self.root / "figure.png").read_bytes()
                self.write_manifest({"png": {**record, "bytes": len(data), "sha256": inspector.sha256(data)}})
                evidence = self.inspect()
                self.assertEqual(evidence["status"], "passed")
                self.assertGreater(self.find_check(evidence, "png_pixels")["foreground_fraction"], 0.1)

    @unittest.skipIf(inspector.Image is None, "Pillow unavailable: real pixel decoding not verified")
    def test_solid_white_colored_black_and_transparent_fail(self) -> None:
        for color in ((255, 255, 255, 255), (10, 20, 30, 255), (0, 0, 0, 255), (10, 20, 30, 0)):
            with self.subTest(color=color):
                self.write_manifest({"png": self.artifact("figure.png", png_bytes(color=color), 40, 24)})
                evidence = self.inspect()
                self.assertEqual(self.find_check(evidence, "png_pixels")["status"], "failed")

    @unittest.skipIf(inspector.Image is None, "Pillow unavailable: real pixel decoding not verified")
    def test_hidden_rgb_noise_and_near_white_noise_fail(self) -> None:
        for transparent in (True, False):
            image = inspector.Image.new("RGBA", (40, 24), (255, 255, 255, 0 if transparent else 255))
            image.putpixel((0, 0), (0, 0, 0, 0) if transparent else (253, 254, 255, 255))
            image.save(self.root / "figure.png")
            data = (self.root / "figure.png").read_bytes()
            self.write_manifest({"png": self.artifact("figure.png", data, 40, 24)})
            self.assertEqual(self.inspect()["status"], "failed")

    @unittest.skipIf(inspector.Image is None, "Pillow unavailable: real pixel decoding not verified")
    def test_single_dark_pixel_is_below_nonblank_threshold(self) -> None:
        image = inspector.Image.new("RGBA", (100, 100), "white")
        image.putpixel((50, 50), (0, 0, 0, 255))
        image.save(self.root / "figure.png")
        self.write_manifest({"png": self.artifact("figure.png", (self.root / "figure.png").read_bytes(), 100, 100)})
        self.assertEqual(self.inspect()["status"], "failed")

    @unittest.skipIf(inspector.Image is None, "Pillow unavailable: real pixel decoding not verified")
    def test_corrupt_idat_and_truncated_data_fail(self) -> None:
        data = png_bytes()
        corrupted = bytearray(data)
        corrupted[45] ^= 1
        for content in (bytes(corrupted), data[:50]):
            self.write_manifest({"png": self.artifact("figure.png", content, 40, 24)})
            self.assertEqual(self.inspect()["status"], "failed")

    @unittest.skipIf(inspector.Image is None, "Pillow unavailable: real pixel decoding not verified")
    def test_every_manifest_png_is_checked(self) -> None:
        valid = self.artifact("good.png", png_bytes(), 40, 24)
        blank = self.artifact("blank.png", png_bytes(color=(255, 255, 255, 255)), 40, 24)
        payload = self.write_manifest({"png": valid})
        payload["figures"].append({"id": "second", "exports": {"png": blank}})
        self.manifest.write_text(json.dumps(payload), encoding="utf-8")
        evidence = self.inspect()
        self.assertEqual(evidence["summary"], {"passed": 1, "failed": 1, "not_verified": 0, "artifact_count": 2})


class SVGTests(ArtifactTestCase):
    def check_svg(self, data: bytes, **metadata: object) -> dict:
        self.write_manifest({"svg": self.artifact("figure.svg", data, **metadata)})
        return self.inspect()

    def test_valid_native_geometry_and_accessibility(self) -> None:
        evidence = self.check_svg(svg_bytes(), title="Synthetic & local",
                                  description="A local test fixture, not observed data.",
                                  viewbox_width=240, viewbox_height=120)
        self.assertEqual(evidence["status"], "passed")
        self.assertEqual(self.find_check(evidence, "svg_geometry")["native_viewbox"], [10, 20, 240, 120])

    def test_r2026_physical_inches_differ_from_manifest_pixel_dimensions(self) -> None:
        data = (svg_bytes().replace(b'width="120px" height="60px"', b'width="2400px" height="1500px"')
                .replace(b'viewBox="10 20 240 120"', b'viewBox="10 20 576 360"')
                .replace(b'width:1.25in;height:0.625in', b'width:8in;height:5in')
                .replace(b'role="img"', b'role="img" data-physical-width-in="8" data-physical-height-in="5"'))
        record = self.artifact("figure.svg", data, 2400, 1500, physical_width_in=8,
                               physical_height_in=5, viewbox_width=576, viewbox_height=360)
        self.write_manifest({"svg": record})
        evidence = self.inspect()
        self.assertEqual(evidence["status"], "passed")
        geometry = self.find_check(evidence, "svg_geometry")
        self.assertEqual(geometry["width_px"], 2400)
        self.assertEqual(geometry["css_width_px"], 768)
        self.assertEqual(geometry["physical_width_in"], 8)
        self.write_manifest({"svg": {**record, "width": 768}})
        self.assertEqual(self.inspect()["status"], "failed")
        self.write_manifest({"svg": {**record, "physical_width_in": 9}})
        self.assertEqual(self.inspect()["status"], "failed")
        tampered = data.replace(b'data-physical-width-in="8"', b'data-physical-width-in="9"')
        self.write_manifest({"svg": self.artifact("figure.svg", tampered, 2400, 1500)})
        self.assertEqual(self.inspect()["status"], "failed")

    def test_duplicate_attributes_and_malformed_xml_fail(self) -> None:
        for data in (svg_bytes().replace(b'width="120px"', b'width="120px" width="120px"'),
                     svg_bytes().replace(b'xlink:href="#shape"', b'xmlns:alias="http://www.w3.org/1999/xlink" xlink:href="#shape" alias:href="#shape"'),
                     svg_bytes().replace(b"</svg>", b"")):
            self.assertEqual(self.check_svg(data)["status"], "failed")

    def test_ratio_lengths_viewbox_and_css_mismatch_fail(self) -> None:
        for old, new in ((b'viewBox="10 20 240 120"', b'viewBox="10 20 120 120"'),
                         (b'viewBox="10 20 240 120"', b'viewBox="10 20 0 120"'),
                         (b'viewBox="10 20 240 120"', b'viewBox="0 0 1e999 10"'),
                         (b'viewBox="10 20 240 120"', b'viewBox="10 20 240"'),
                         (b'width="120px"', b'width="100%"'),
                         (b'height="60px"', b'height="0px"'),
                         (b"width:1.25in", b"width:2.5in")):
            with self.subTest(new=new):
                self.assertEqual(self.check_svg(svg_bytes().replace(old, new))["status"], "failed")
        self.assertEqual(self.check_svg(svg_bytes(), viewbox_width=120, viewbox_height=60)["status"], "failed")

    def test_title_description_and_accessible_names_are_not_optional(self) -> None:
        for old, new in ((b"Synthetic &amp; local", b"   "),
                         (b"A local test fixture, not observed data.", b" "),
                         (b'<title id="title">', b'<title id="title"/><title>'),
                         (b'role="img"', b'role="presentation"'),
                         (b'role="img"', b'role="img" aria-hidden="true"'),
                         (b'role="img"', b'role="img" aria-label=" "'),
                         (b'aria-labelledby="title"', b'aria-labelledby="missing"'),
                         (b'aria-labelledby="title"', b'aria-labelledby="shape"'),
                         (b'role="img"', b'role="img" display="none"')):
            with self.subTest(new=new):
                self.assertEqual(self.check_svg(svg_bytes().replace(old, new))["status"], "failed")

    def test_external_active_and_unresolved_references_fail(self) -> None:
        for target in (b"https://example.invalid/image.svg", b"//example.invalid/x", b"file:///etc/passwd",
                       b"../outside.svg", b"javascript:alert(1)", b"data:image/svg+xml;base64,PHN2Zy8+", b"#missing"):
            with self.subTest(target=target):
                evidence = self.check_svg(svg_bytes().replace(b'xlink:href="#shape"', b'xlink:href="' + target + b'"'))
                self.assertEqual(self.find_check(evidence, "svg_references")["status"], "failed")
        for injected in (b'<script>alert(1)</script>', b'<foreignObject/>', b'<set attributeName="href" to="https://example.invalid"/>',
                         b'<rect onclick="alert(1)"/>', b'<g xml:base="https://example.invalid"/>',
                         b'<path id="shape"/>', b'<style>@import "https://example.invalid/x.css";</style>',
                         b'<style>path{fill:url(https://example.invalid/x)}</style>',
                         b'<style>path{fill:image("https://example.invalid/x")}</style>',
                         b'<rect fill="u\\72l(https://example.invalid/x)"/>',
                         b'<style>svg{width:90px;height:80px}</style>'):
            with self.subTest(injected=injected):
                self.assertEqual(self.check_svg(svg_bytes().replace(b"</svg>", injected + b"</svg>"))["status"], "failed")

    def test_entity_declarations_and_processing_instructions_fail_even_utf16(self) -> None:
        for prefix in ('<!DOCTYPE svg [<!ENTITY external SYSTEM "file:///etc/passwd">]>',
                       '<!DOCTYPE svg SYSTEM "https://example.invalid/svg.dtd">',
                       '<?xml-stylesheet href="https://example.invalid/style.css"?>'):
            source = svg_bytes().decode().split("?>", 1)[1]
            for encoding in ("utf-8", "utf-16"):
                data = (f'<?xml version="1.0" encoding="{encoding}"?>' + prefix + source).encode(encoding)
                with self.subTest(prefix=prefix, encoding=encoding):
                    self.assertEqual(self.check_svg(data)["status"], "failed")

    def test_local_fragment_css_and_embedded_raster_are_safe(self) -> None:
        raster = b'<image href="data:image/png;base64,' + base64.b64encode(png_bytes()) + b'"/>'
        data = svg_bytes().replace(b"</svg>", raster + b"<style>path{clip-path:url('#clip');stroke:rgb(0,0,0)}</style></svg>")
        self.assertEqual(self.check_svg(data)["status"], "passed")
        bad = data.replace(base64.b64encode(png_bytes()), base64.b64encode(b"not a PNG"))
        self.assertEqual(self.check_svg(bad)["status"], "failed")


class PDFTests(ArtifactTestCase):
    def test_both_missing_tools_are_not_verified(self) -> None:
        self.write_manifest({"pdf": self.artifact("figure.pdf", pdf_bytes())})
        with mock.patch.object(inspector.shutil, "which", return_value=None):
            evidence = self.inspect()
        self.assertEqual(evidence["status"], "not_verified")
        for name in ("pdfinfo", "pdffonts"):
            self.assertEqual(self.find_check(evidence, name)["status"], "not_verified")

    def test_missing_one_tool_does_not_pass(self) -> None:
        self.write_manifest({"pdf": self.artifact("figure.pdf", pdf_bytes())})
        for missing in ("pdfinfo", "pdffonts"):
            dependencies = {name: {"path": None if name == missing else f"/tools/{name}"}
                            for name in ("pdfinfo", "pdffonts")}
            checks = []
            with mock.patch.object(inspector.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")):
                inspector.inspect_pdf(pdf_bytes(), None, checks, dependencies, 1)
            self.assertNotEqual(inspector.combined_status(checks), "passed")
            self.assertEqual(next(check for check in checks if check["name"] == missing)["status"], "not_verified")

    def test_tool_failure_timeout_and_stderr_cannot_pass(self) -> None:
        for outcome in (subprocess.CompletedProcess([], 1, "", "broken xref"),
                        subprocess.CompletedProcess([], 0, "plausible output", "Syntax Warning: damaged file"),
                        subprocess.TimeoutExpired("pdfinfo", 1), FileNotFoundError("tool vanished")):
            checks = []
            options = {"side_effect": outcome} if isinstance(outcome, Exception) else {"return_value": outcome}
            with self.subTest(outcome=outcome), mock.patch.object(inspector.subprocess, "run", **options):
                output = inspector.run_pdf_tool("pdfinfo", "/tools/pdfinfo", ["artifact.pdf"], 1, checks)
            self.assertIsNone(output)
            self.assertNotEqual(inspector.combined_status(checks), "passed")

    def test_pdf_tool_uses_exact_hash_snapshot_no_shell_and_c_locale(self) -> None:
        data = pdf_bytes()
        dependencies = {name: {"path": f"/tools/{name}"} for name in ("pdfinfo", "pdffonts")}

        def run(command: list[str], **options: object) -> subprocess.CompletedProcess:
            self.assertEqual(Path(command[-1]).read_bytes(), data)
            self.assertEqual(options["env"]["LC_ALL"], "C")
            self.assertNotIn("shell", options)
            self.assertEqual(options["timeout"], 3)
            return subprocess.CompletedProcess(command, 1, "", "intentional unit-test failure")

        with mock.patch.object(inspector.subprocess, "run", side_effect=run) as invoked:
            inspector.inspect_pdf(data, None, [], dependencies, 3)
        self.assertEqual(invoked.call_count, 2)

    def test_unparseable_tool_output_fails(self) -> None:
        with self.assertRaises(inspector.InspectionError):
            inspector.parse_pdfinfo("Pages: 1\n", None, [])
        with self.assertRaises(inspector.InspectionError):
            inspector.parse_pdffonts("looks like fonts", [])

    @unittest.skipUnless(all(shutil.which(name) for name in ("pdfinfo", "pdffonts", "pdftotext")), "system Poppler tools unavailable")
    def test_system_tools_inspect_valid_embedded_font_pdf(self) -> None:
        self.write_manifest({"pdf": self.artifact("figure.pdf", pdf_bytes())})
        evidence = self.inspect()
        self.assertEqual(evidence["status"], "passed", json.dumps(evidence, indent=2))
        self.assertEqual(self.find_check(evidence, "pdf_structure")["page_count"], 1)
        self.assertEqual(self.find_check(evidence, "pdf_font_embedding")["status"], "passed")
        text = self.find_check(evidence, "pdf_text_integrity")
        self.assertEqual(text["status"], "passed")
        self.assertEqual(text["snapshot_sha256"], evidence["artifacts"][0]["sha256"])
        self.assertEqual(text["bbox_output_sha256"], self.find_check(evidence, "pdftotext")["bbox_output_sha256"])

    @unittest.skipUnless(shutil.which("pdfinfo") and shutil.which("pdffonts"), "system Poppler tools unavailable")
    def test_system_tools_reject_fake_and_damaged_pdf(self) -> None:
        for data in (b"%PDF-1.4\n/MediaBox [0 0 120 60]\n%%EOF", pdf_bytes()[:100]):
            self.write_manifest({"pdf": self.artifact("figure.pdf", data)})
            self.assertEqual(self.inspect()["status"], "failed")

    @unittest.skipUnless(shutil.which("pdfinfo") and shutil.which("pdffonts"), "system Poppler tools unavailable")
    def test_nonembedded_and_absent_fonts_never_claim_embedding_pass(self) -> None:
        for font, status in (("unembedded", "failed"), ("none", "not_verified")):
            self.write_manifest({"pdf": self.artifact("figure.pdf", pdf_bytes(font=font))})
            evidence = self.inspect()
            self.assertEqual(self.find_check(evidence, "pdf_font_embedding")["status"], status)
            self.assertEqual(evidence["status"], status)

    @unittest.skipUnless(all(shutil.which(name) for name in ("pdfinfo", "pdffonts", "pdftotext")), "system Poppler tools unavailable")
    def test_every_pdf_page_geometry_and_count_checked(self) -> None:
        cases = (((120, 60), (120, 60)), ((120, 60), (120, 80)))
        for sizes in cases:
            record = self.artifact("figure.pdf", pdf_bytes(sizes=sizes), pages=2)
            self.write_manifest({"pdf": record})
            evidence = self.inspect()
            self.assertEqual(evidence["status"], "passed" if sizes[0] == sizes[1] else "failed")
        self.write_manifest({"pdf": {**record, "pages": 1}})
        self.assertEqual(self.inspect()["status"], "failed")


def bbox_bytes(pages: list[list[str]], *, rotated: bool = False, metadata_title: str = "") -> bytes:
    root = ElementTree.Element("html", xmlns=inspector.XHTML_NAMESPACE)
    head = ElementTree.SubElement(root, "head")
    ElementTree.SubElement(head, "title").text = metadata_title
    document = ElementTree.SubElement(ElementTree.SubElement(root, "body"), "doc")
    for words in pages:
        page = ElementTree.SubElement(document, "page", width="600", height="400")
        block = ElementTree.SubElement(ElementTree.SubElement(page, "flow"), "block")
        line = ElementTree.SubElement(block, "line")
        for index, word in enumerate(words):
            horizontal = 20 if rotated else 20 + index * 15
            vertical = 300 - index * 15 if rotated else 20
            ElementTree.SubElement(line, "word", xMin=str(horizontal), xMax=str(horizontal + 10),
                                   yMin=str(vertical), yMax=str(vertical + 10)).text = word
    return inspector.PDF_TEXT_DOCTYPE + ElementTree.tostring(root, encoding="utf-8")


class PDFTextTests(ArtifactTestCase):
    def inspect_text(self, output: bytes | None, figure: dict, *, fonts: list | None = None) -> dict:
        data = pdf_bytes()
        snapshot = self.root / "snapshot.pdf"
        snapshot.write_bytes(data)
        checks = [{"name": "pdf_font_inventory", "status": "passed",
                   "fonts": [{"unicode_map": "yes"}] if fonts is None else fonts}]
        with mock.patch.object(inspector, "run_pdftotext", return_value=output):
            inspector.inspect_pdf_text(snapshot, data, figure, checks, "/unit-only/pdftotext", 1)
        return {check["name"]: check for check in checks}

    def test_collects_title_axes_and_unmeasured_layout_strings_without_geometry_claims(self) -> None:
        figure = {"title": "Ocean profile", "axes_objects": {"xlabel": "Temperature (degC)", "ylabel": "Depth (m)"},
                  "axes": [{"xlabel": "Station distance"}],
                  "text_objects": {"role": "title", "string": "Ocean profile"},
                  "unmeasured_text_objects": {"role": "layout.title", "string": "Readable layout title",
                                              "geometry_status": "unverified"}}
        checks = self.inspect_text(bbox_bytes([["Ocean profile", "Temperature (degC)", "Depth (m)",
                                               "Station distance", "Readable layout title"]]), figure)
        integrity = checks["pdf_text_integrity"]
        self.assertEqual(integrity["status"], "passed")
        self.assertEqual(integrity["expected_count"], 5)
        self.assertEqual(integrity["labels"][0]["sources"], ["title", "text_objects[0].string"])
        self.assertEqual(integrity["labels"][-1]["sources"], ["unmeasured_text_objects[0].string"])
        self.assertNotIn("clipped", json.dumps(checks))
        self.assertNotIn("visual_inspection_verified", checks)

    def test_rotated_bbox_preserves_emitted_word_order_not_y_sort(self) -> None:
        label = "Depth (m, positive down; reference: mean sea level)"
        checks = self.inspect_text(bbox_bytes([label.split()], rotated=True),
                                   {"axes_objects": [{"ylabel": label}]})
        self.assertEqual(checks["pdf_text_integrity"]["status"], "passed")
        self.assertEqual(checks["pdf_text_extractability"]["pages"][0]["text_excerpt"], label)

    def test_unicode_normalization_whitespace_and_chinese_line_breaks(self) -> None:
        figure = {"title": "\u5357\u6d77\u6d77\u8868\u6e29\u5ea6", "axes_objects": {
            "xlabel": ["Caf\u00e9", "office"], "ylabel": "Sea\u00a0temperature"}}
        output = bbox_bytes([["\u5357\u6d77\n\u6d77\u8868", "\u6e29\u5ea6", "Cafe\u0301", "o\ufb03ce", "Sea\n temperature"]])
        self.assertEqual(self.inspect_text(output, figure)["pdf_text_integrity"]["status"], "passed")

    def test_partial_mapped_latin_label_exposes_missing_complete_text(self) -> None:
        label = "Depth (m, positive down; reference: mean sea level)"
        figure = {"title": "Ocean profile", "axes_objects": {"ylabel": label}}
        output = bbox_bytes([["Depth", "(m,", "positive", "down;", "reference:", "m", "Ocean", "profile"]], rotated=True)
        checks = self.inspect_text(output, figure)
        self.assertEqual(checks["pdf_text_extractability"]["status"], "passed")
        integrity = checks["pdf_text_integrity"]
        self.assertEqual(integrity["status"], "failed")
        self.assertEqual(integrity["labels"][0]["status"], "passed")
        self.assertEqual(integrity["labels"][1]["matching_pages"], [])
        self.assertEqual(integrity["labels"][1]["partial_matches"], [{"page": 1, "fragment": "Depth (m,"}])
        self.assertIn("no visual or clipping-cause conclusion", integrity["reason"])

    def test_outlined_missing_mappings_and_unextractable_cjk_are_not_verified(self) -> None:
        label = "Depth (m, positive down; reference: mean sea level)"
        partial = bbox_bytes([["Depth", "(m,"]])
        for output, fonts, figure in (
                (bbox_bytes([[]]), [], {"title": label}),
                (partial, [], {"title": label}),
                (partial, [{"unicode_map": "no"}], {"title": label}),
                (bbox_bytes([["Depth", "(m,", "\ufffd"]]), None, {"title": label}),
                (bbox_bytes([["Depth", "(m,", "\ue000"]]), None, {"title": label}),
                (bbox_bytes([["Ocean", "profile"]]), None, {"title": "\u5357\u6d77\u6d77\u8868\u6e29\u5ea6"}),
                (partial, None, {"title": "Entirely unavailable title"}),
                (None, None, {"title": label})):
            with self.subTest(output=output, fonts=fonts):
                checks = self.inspect_text(output, figure, fonts=fonts)
                self.assertEqual(checks["pdf_text_integrity"]["status"], "not_verified")
                self.assertNotIn("invisible", json.dumps(checks))

    def test_missing_expectations_metadata_titles_and_cross_page_fragments_cannot_pass(self) -> None:
        for output, figure in ((bbox_bytes([["A"]]), {}),
                               (bbox_bytes([["Unrelated"]], metadata_title="Ocean profile"), {"title": "Ocean profile"}),
                               (bbox_bytes([["Ocean"], ["profile"]]), {"title": "Ocean profile"}),
                               (bbox_bytes([["Stations"]]), {"title": "Station"})):
            self.assertEqual(self.inspect_text(output, figure)["pdf_text_integrity"]["status"], "not_verified")

    def test_untrusted_bbox_xml_is_rejected_without_entity_expansion(self) -> None:
        valid = bbox_bytes([["A"]])
        body = valid[len(inspector.PDF_TEXT_DOCTYPE):]
        malicious = [b'<!DOCTYPE html [<!ENTITY leak SYSTEM "file:///etc/passwd">]>' + body.replace(b">A<", b">&leak;<"),
                     b'<!DOCTYPE html SYSTEM "https://example.invalid/external.dtd">' + body,
                     inspector.PDF_TEXT_DOCTYPE[:-1] + b' [<!ENTITY leak "expanded">]>' + body,
                     inspector.PDF_TEXT_DOCTYPE + b'<!DOCTYPE html [<!ENTITY leak "expanded">]>' + body,
                     b'<?xml-stylesheet href="https://example.invalid/x"?>' + body,
                     valid.replace(b'<word ', b'<word href="file:///etc/passwd" '),
                     valid.replace(b'xMin="20"', b'xMin="20" xMin="20"'),
                     valid.replace(b'xMax="30"', b'xMax="NaN"'),
                     valid.replace(b"</html>", b"<script>A</script></html>"),
                     valid[:100], valid.decode().encode("utf-16")]
        for output in malicious:
            with self.subTest(output=output[:100]):
                self.assertEqual(self.inspect_text(output, {"title": "A"})["pdf_text_integrity"]["status"], "failed")
        with mock.patch.object(inspector, "MAX_PDF_TEXT_BYTES", 64):
            self.assertEqual(self.inspect_text(valid, {"title": "A"})["pdf_text_integrity"]["status"], "failed")

    def test_expected_text_limits_are_not_silent_truncation(self) -> None:
        for figure in ({"title": "x" * (inspector.MAX_EXPECTED_PDF_TEXT_LENGTH + 1)},
                       {"title": 123}, {"axes_objects": "invalid"},
                       {"text_objects": [{"role": "title", "string": "A"}]
                                         * (inspector.MAX_EXPECTED_PDF_TEXTS + 1)},
                       {"text_objects": [{"role": "title", "string": f"Title {index}"}
                                         for index in range(inspector.MAX_EXPECTED_PDF_TEXTS + 1)]}):
            self.assertEqual(self.inspect_text(bbox_bytes([["A"]]), figure)["pdf_text_integrity"]["status"], "failed")

    def test_missing_tool_is_explicit_and_does_not_launch_another_tool(self) -> None:
        checks = []
        snapshot = self.root / "snapshot.pdf"
        snapshot.write_bytes(pdf_bytes())
        with mock.patch.object(inspector.subprocess, "Popen") as launch:
            inspector.inspect_pdf_text(snapshot, pdf_bytes(), {"title": "A"}, checks, None, 1)
        launch.assert_not_called()
        self.assertEqual({check["name"]: check["status"] for check in checks},
                         {"pdf_text_extractability": "not_verified", "pdf_text_integrity": "not_verified"})

    @unittest.skipUnless(shutil.which("pdfinfo") and shutil.which("pdffonts"), "system PDF structural tools unavailable")
    def test_missing_pdftotext_keeps_structure_and_font_checks_but_cannot_pass(self) -> None:
        self.write_manifest({"pdf": self.artifact("figure.pdf", pdf_bytes())})
        inventory = inspector.dependency_inventory()
        inventory["pdftotext"] = {"path": None, "status": "not_verified"}
        with mock.patch.object(inspector, "dependency_inventory", return_value=inventory):
            evidence = self.inspect()
        self.assertEqual(evidence["status"], "not_verified")
        self.assertEqual(self.find_check(evidence, "pdf_structure")["status"], "passed")
        self.assertEqual(self.find_check(evidence, "pdf_font_embedding")["status"], "passed")
        self.assertEqual(self.find_check(evidence, "pdf_text_integrity")["status"], "not_verified")

    def test_bounded_unit_process_failure_warning_timeout_and_output_limits(self) -> None:
        executable = self.directory / "unit-only-text-tool"
        snapshot = self.root / "snapshot.pdf"
        snapshot.write_bytes(pdf_bytes())
        for program, timeout, limit in (("raise SystemExit(7)", 1, 1024),
                                        ("import sys; sys.stderr.write('font mapping warning')", 1, 1024),
                                        ("import time; time.sleep(5)", 0.05, 1024),
                                        ("import sys; sys.stdout.write('x' * 10000)", 1, 128),
                                        ("import sys; sys.stderr.write('x' * 10000)", 1, 128)):
            executable.write_text(f"#!{sys.executable}\n{program}\n", encoding="utf-8")
            executable.chmod(0o755)
            checks = []
            with self.subTest(program=program), mock.patch.object(inspector, "MAX_PDF_TEXT_BYTES", limit):
                output = inspector.run_pdftotext(snapshot, str(executable), timeout, checks, inspector.sha256(pdf_bytes()))
            self.assertIsNone(output)
            self.assertEqual(checks[0]["status"], "not_verified")
            self.assertLessEqual(checks[0]["stdout_bytes"] + checks[0]["stderr_bytes"], limit + 1)
        checks = []
        self.assertIsNone(inspector.run_pdftotext(snapshot, str(self.directory / "missing-tool"), 1, checks, "hash"))
        self.assertEqual(checks[0]["status"], "not_verified")

    @unittest.skipUnless(shutil.which("pdftotext"), "system pdftotext unavailable")
    def test_system_text_tool_snapshot_arguments_hash_and_locale(self) -> None:
        data = pdf_bytes()
        snapshot = self.root / "snapshot.pdf"
        snapshot.write_bytes(data)
        checks = []
        original = inspector.subprocess.Popen

        def launch(command: list[str], **options: object) -> subprocess.Popen:
            self.assertEqual(Path(command[-2]).read_bytes(), data)
            self.assertEqual(command[-1], "-")
            self.assertIn("-bbox-layout", command)
            self.assertEqual(options["env"]["LC_ALL"], "C")
            self.assertNotIn("shell", options)
            return original(command, **options)

        with mock.patch.object(inspector.subprocess, "Popen", side_effect=launch):
            output = inspector.run_pdftotext(snapshot, shutil.which("pdftotext"), 3, checks, inspector.sha256(data))
        self.assertIsNotNone(output)
        self.assertEqual(checks[0]["bbox_output_sha256"], inspector.sha256(output))
        self.assertEqual(checks[0]["snapshot_sha256"], inspector.sha256(data))
        self.assertEqual(inspector.parse_pdf_text(output)[0]["text"], "A")

    @unittest.skipUnless(all(shutil.which(name) for name in ("pdfinfo", "pdffonts", "pdftotext")), "system Poppler tools unavailable")
    def test_pdf_text_snapshot_or_original_mutation_invalidates_binding(self) -> None:
        data = pdf_bytes()
        original = inspector.run_pdftotext
        for mutate_snapshot in (True, False):
            self.write_manifest({"pdf": self.artifact("figure.pdf", data)})

            def mutate(snapshot: Path, *arguments: object) -> bytes | None:
                output = original(snapshot, *arguments)
                target = snapshot if mutate_snapshot else self.root / "figure.pdf"
                target.write_bytes(target.read_bytes() + b"\n")
                return output

            with self.subTest(snapshot=mutate_snapshot), mock.patch.object(inspector, "run_pdftotext", side_effect=mutate):
                evidence = self.inspect()
            self.assertEqual(evidence["status"], "failed")
            self.assertIn("changed during inspection", json.dumps(evidence))


class CLITests(ArtifactTestCase):
    def run_cli(self, *extra: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, "-B", str(MODULE_PATH), "--manifest", str(self.manifest),
                               "--artifact-root", str(self.root), *extra], capture_output=True, text=True, timeout=30)

    def test_success_stdout_and_new_output_file(self) -> None:
        self.write_manifest({"svg": self.artifact("figure.svg", svg_bytes())})
        process = self.run_cli()
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout)["status"], "passed")
        output = self.directory / "evidence.json"
        process = self.run_cli("--output", str(output))
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stdout, "")
        self.assertEqual(json.loads(output.read_text())["status"], "passed")
        original = output.read_bytes()
        self.assertEqual(self.run_cli("--output", str(output)).returncode, 1)
        self.assertEqual(output.read_bytes(), original)

    def test_missing_inputs_write_failed_json(self) -> None:
        process = self.run_cli()
        self.assertEqual(process.returncode, 1)
        self.assertEqual(json.loads(process.stdout)["status"], "failed")

    def test_not_verified_returns_exit_two_without_site_packages(self) -> None:
        self.write_manifest({"png": self.artifact("figure.png", png_bytes(), 40, 24)})
        process = subprocess.run([sys.executable, "-B", "-S", str(MODULE_PATH), "--manifest", str(self.manifest),
                                  "--root", str(self.root)], capture_output=True, text=True, timeout=30)
        self.assertEqual(process.returncode, 2, process.stderr)
        self.assertEqual(json.loads(process.stdout)["status"], "not_verified")

    def test_cli_cannot_overwrite_manifest_or_artifact(self) -> None:
        self.write_manifest({"svg": self.artifact("figure.svg", svg_bytes())})
        for target in (self.manifest, self.root / "figure.svg"):
            before = target.read_bytes()
            process = self.run_cli("--output", str(target))
            self.assertEqual(process.returncode, 1)
            self.assertEqual(target.read_bytes(), before)

    def test_nonfinite_timeout_is_cli_error(self) -> None:
        self.assertEqual(self.run_cli("--pdf-timeout", "nan").returncode, 2)


if __name__ == "__main__":
    unittest.main()
