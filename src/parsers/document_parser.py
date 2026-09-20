#!/usr/bin/env python3
"""
MedStudy Atlas — Secure Document Parser Subprocess
Phase 1D: Secure Document Processing / Ingestion & Page Provenance.

Responsibilities:
1. Structural preflight via qpdf (corruption, encryption, page counts).
2. PDFium inspection & native text extraction (pypdfium2).
3. Selective local OCR via Tesseract 5.x (spa + eng) only for scanned/image-based pages.
4. Deterministic text normalization and page provenance guarantees.
5. Strict output serialization (manifest.json and per-page json files).

SECURITY INVARIANTS:
- Application credentials are not inherited through the parser child-process environment.
- Bounded resource budgets enforced before expensive operations.
- Render pixel limits enforced prior to bitmap rasterization.
- Prompt injection text is extracted as inert USER_DOCUMENT_UNTRUSTED data.
- Temporary files guaranteed removed in finally blocks.
"""

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pypdfium2 as pdfium
import pytesseract
from PIL import Image

# Default fallback limits (overridden by --config from trusted orchestrator)
DEFAULT_MAX_PAGES_PER_DOCUMENT = 300
DEFAULT_MAX_OCR_PAGES_PER_DOCUMENT = 60
DEFAULT_MAX_EXTRACTED_CHARS_PER_PAGE = 100_000
DEFAULT_MAX_EXTRACTED_CHARS_PER_DOCUMENT = 3_000_000
DEFAULT_MAX_RENDER_PIXELS_PER_PAGE = 12_000_000
DEFAULT_MAX_PAGE_DIMENSION_POINTS = 5000
DEFAULT_PREFLIGHT_TIMEOUT_SECONDS = 10
DEFAULT_OCR_PAGE_TIMEOUT_SECONDS = 20
DEFAULT_MIN_NATIVE_CHARS_FOR_TEXT = 50
DEFAULT_PIPELINE_VERSION = "1.0.0"


def run_bounded_cmd(cmd: List[str], timeout_sec: int, max_bytes: int = 65536) -> Tuple[int, str, str]:
    """
    Executes a child process with a hard wall-clock timeout and bounded stream buffers (max_bytes)
    to prevent memory exhaustion from verbose or adversarial diagnostic output.
    Raises:
      subprocess.TimeoutExpired: if process does not terminate within timeout_sec
      ValueError: if stdout or stderr stream exceeds max_bytes
    """
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        shell=False,
    )

    stdout_chunks: List[bytes] = []
    stderr_chunks: List[bytes] = []
    exceeded = [False]

    def read_stream(stream, chunks: List[bytes]):
        total = 0
        while True:
            chunk = stream.read(4096)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                exceeded[0] = True
                try:
                    proc.kill()
                except Exception:
                    pass
                break
            chunks.append(chunk)

    t_out = threading.Thread(target=read_stream, args=(proc.stdout, stdout_chunks))
    t_err = threading.Thread(target=read_stream, args=(proc.stderr, stderr_chunks))
    t_out.daemon = True
    t_err.daemon = True
    t_out.start()
    t_err.start()

    try:
        proc.wait(timeout=timeout_sec)
        t_out.join(timeout=1.0)
        t_err.join(timeout=1.0)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except Exception:
            pass
        t_out.join(timeout=1.0)
        t_err.join(timeout=1.0)
        raise subprocess.TimeoutExpired(cmd, timeout_sec)

    if exceeded[0]:
        raise ValueError(f"Diagnostic output exceeded limit of {max_bytes} bytes")

    stdout_str = b"".join(stdout_chunks).decode("utf-8", errors="replace")
    stderr_str = b"".join(stderr_chunks).decode("utf-8", errors="replace")
    return proc.returncode, stdout_str, stderr_str


def normalize_text(text: str) -> str:
    """
    Deterministic conservative normalization:
    - CRLF and CR -> LF
    - Strip invalid NUL / non-printable control characters (preserving tab and newline)
    - Normalize trailing whitespace on lines
    - Prompt injection is preserved as inert document content without modification.
    """
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Filter non-printable ASCII control characters except tab and newline
    clean_chars = []
    for ch in text:
        code = ord(ch)
        if code == 0:
            continue
        if code < 32 and code not in (9, 10):
            continue
        clean_chars.append(ch)
    cleaned = "".join(clean_chars)

    # Clean whitespace per line
    lines = [line.rstrip() for line in cleaned.split("\n")]
    return "\n".join(lines).strip()


def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class DocumentParser:
    def __init__(
        self,
        input_path: Path,
        output_dir: Path,
        temp_dir: Path,
        qpdf_path: Optional[str] = None,
        tesseract_path: Optional[str] = None,
        source_sha256: Optional[str] = None,
        config_json: Optional[str] = None,
    ):
        self.input_path = input_path
        self.output_dir = output_dir
        self.temp_dir = temp_dir
        self.pages_dir = output_dir / "pages"
        self.qpdf_path = qpdf_path or "qpdf"
        self.tesseract_path = tesseract_path
        self.source_sha256 = source_sha256

        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.pages_dir.mkdir(parents=True, exist_ok=True)
        self.temp_dir.mkdir(parents=True, exist_ok=True)

        if self.tesseract_path:
            pytesseract.pytesseract.tesseract_cmd = self.tesseract_path

        # Parse and validate configuration from orchestrator
        self.load_and_validate_config(config_json)

    def load_and_validate_config(self, config_json: Optional[str]) -> None:
        self.max_pages_per_document = DEFAULT_MAX_PAGES_PER_DOCUMENT
        self.max_ocr_pages_per_document = DEFAULT_MAX_OCR_PAGES_PER_DOCUMENT
        self.max_extracted_chars_per_page = DEFAULT_MAX_EXTRACTED_CHARS_PER_PAGE
        self.max_extracted_chars_per_document = DEFAULT_MAX_EXTRACTED_CHARS_PER_DOCUMENT
        self.max_render_pixels_per_page = DEFAULT_MAX_RENDER_PIXELS_PER_PAGE
        self.max_page_dimension_points = DEFAULT_MAX_PAGE_DIMENSION_POINTS
        self.preflight_timeout_seconds = DEFAULT_PREFLIGHT_TIMEOUT_SECONDS
        self.ocr_page_timeout_seconds = DEFAULT_OCR_PAGE_TIMEOUT_SECONDS
        self.min_native_chars_for_text = DEFAULT_MIN_NATIVE_CHARS_FOR_TEXT
        self.pipeline_version = DEFAULT_PIPELINE_VERSION

        if not config_json:
            sys.stderr.write("Error: --config argument is required for document parser invocation\n")
            self.write_failure_manifest("PARSER_INTERNAL_ERROR", 0)
            sys.exit(1)

        try:
            cfg = json.loads(config_json)
            if not isinstance(cfg, dict):
                raise ValueError("Config must be a JSON object")

            self.max_pages_per_document = int(cfg.get("maxPagesPerDocument", self.max_pages_per_document))
            self.max_ocr_pages_per_document = int(cfg.get("maxOcrPagesPerDocument", self.max_ocr_pages_per_document))
            self.max_extracted_chars_per_page = int(cfg.get("maxExtractedCharsPerPage", self.max_extracted_chars_per_page))
            self.max_extracted_chars_per_document = int(cfg.get("maxExtractedCharsPerDocument", self.max_extracted_chars_per_document))
            self.max_render_pixels_per_page = int(cfg.get("maxRenderPixelsPerPage", self.max_render_pixels_per_page))
            self.max_page_dimension_points = int(cfg.get("maxPageDimensionPoints", self.max_page_dimension_points))
            self.preflight_timeout_seconds = int(cfg.get("preflightTimeoutSeconds", self.preflight_timeout_seconds))
            self.ocr_page_timeout_seconds = int(cfg.get("ocrPageTimeoutSeconds", self.ocr_page_timeout_seconds))
            self.min_native_chars_for_text = int(cfg.get("minNativeCharsForText", self.min_native_chars_for_text))
            self.pipeline_version = str(cfg.get("pipelineVersion", self.pipeline_version))

            # Validate parameter ranges
            if not (1 <= self.max_pages_per_document <= 1000):
                raise ValueError("maxPagesPerDocument out of range [1, 1000]")
            if not (0 <= self.max_ocr_pages_per_document <= 500):
                raise ValueError("maxOcrPagesPerDocument out of range [0, 500]")
            if not (10 <= self.max_extracted_chars_per_page <= 1_000_000):
                raise ValueError("maxExtractedCharsPerPage out of range [10, 1000000]")
            if not (10 <= self.max_extracted_chars_per_document <= 50_000_000):
                raise ValueError("maxExtractedCharsPerDocument out of range [10, 50000000]")
            if not (1_000_000 <= self.max_render_pixels_per_page <= 50_000_000):
                raise ValueError("maxRenderPixelsPerPage out of range [1000000, 50000000]")
            if not (100 <= self.max_page_dimension_points <= 20_000):
                raise ValueError("maxPageDimensionPoints out of range [100, 20000]")
            if not (1 <= self.preflight_timeout_seconds <= 120):
                raise ValueError("preflightTimeoutSeconds out of range [1, 120]")
            if not (1 <= self.ocr_page_timeout_seconds <= 120):
                raise ValueError("ocrPageTimeoutSeconds out of range [1, 120]")
            if not (1 <= self.min_native_chars_for_text <= 500):
                raise ValueError("minNativeCharsForText out of range [1, 500]")
            if not self.pipeline_version.strip():
                raise ValueError("pipelineVersion cannot be empty")

        except Exception as err:
            sys.stderr.write(f"Invalid parser config: {err}\n")
            self.write_failure_manifest("PARSER_INTERNAL_ERROR", 0)
            sys.exit(1)

    def write_failure_manifest(self, error_code: str, warning_count: int = 0) -> None:
        manifest = {
            "pipeline_version": self.pipeline_version,
            "source_sha256": self.source_sha256,
            "page_count": 0,
            "structural_warning_count": warning_count,
            "native_text_page_count": 0,
            "ocr_page_count": 0,
            "no_text_page_count": 0,
            "processing_duration_ms": 0,
            "error_code": error_code,
            "status": "FAILED",
        }
        with open(self.output_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

    def run_preflight(self) -> Tuple[int, int]:
        # 1. Encryption Check (bounded diagnostic stream)
        try:
            rc_enc, _, _ = run_bounded_cmd(
                [self.qpdf_path, "--is-encrypted", str(self.input_path)],
                timeout_sec=self.preflight_timeout_seconds,
            )
            # qpdf --is-encrypted returns 0 if encrypted, 2 if not encrypted
            if rc_enc == 0:
                self.write_failure_manifest("PDF_ENCRYPTED")
                sys.exit(1)
        except subprocess.TimeoutExpired:
            self.write_failure_manifest("PREFLIGHT_TIMEOUT")
            sys.exit(1)
        except ValueError:
            self.write_failure_manifest("PREFLIGHT_FAILED")
            sys.exit(1)
        except Exception:
            self.write_failure_manifest("PARSER_INTERNAL_ERROR")
            sys.exit(1)

        # 2. Structural Check & Warnings (bounded diagnostic stream)
        warning_count = 0
        try:
            rc_check, _, stderr_check = run_bounded_cmd(
                [self.qpdf_path, "--check", str(self.input_path)],
                timeout_sec=self.preflight_timeout_seconds,
            )
            # qpdf exit codes: 0 = clean, 3 = warnings, 2 = errors
            if rc_check == 2:
                self.write_failure_manifest("PDF_CORRUPT")
                sys.exit(1)
            elif rc_check == 3:
                warning_count = len([line for line in stderr_check.splitlines() if "WARNING" in line.upper()])
                if warning_count == 0:
                    warning_count = 1
            elif rc_check != 0:
                self.write_failure_manifest("PDF_CORRUPT")
                sys.exit(1)
        except subprocess.TimeoutExpired:
            self.write_failure_manifest("PREFLIGHT_TIMEOUT")
            sys.exit(1)
        except ValueError:
            self.write_failure_manifest("PREFLIGHT_FAILED")
            sys.exit(1)
        except Exception:
            self.write_failure_manifest("PARSER_INTERNAL_ERROR")
            sys.exit(1)

        # 3. Page Count (bounded diagnostic stream)
        try:
            rc_pages, stdout_pages, _ = run_bounded_cmd(
                [self.qpdf_path, "--show-npages", str(self.input_path)],
                timeout_sec=self.preflight_timeout_seconds,
            )
            if rc_pages not in (0, 3):
                self.write_failure_manifest("PDF_CORRUPT", warning_count)
                sys.exit(1)

            page_count = None
            for line in [l.strip() for l in stdout_pages.splitlines() if l.strip()]:
                if line.isdigit():
                    page_count = int(line)
                    break

            if page_count is None:
                self.write_failure_manifest("PDF_CORRUPT", warning_count)
                sys.exit(1)

            if page_count == 0:
                self.write_failure_manifest("PDF_ZERO_PAGES", warning_count)
                sys.exit(1)

            if page_count > self.max_pages_per_document:
                self.write_failure_manifest("PDF_PAGE_COUNT_EXCEEDED", warning_count)
                sys.exit(1)

            return page_count, warning_count

        except subprocess.TimeoutExpired:
            self.write_failure_manifest("PREFLIGHT_TIMEOUT", warning_count)
            sys.exit(1)
        except ValueError:
            self.write_failure_manifest("PREFLIGHT_FAILED", warning_count)
            sys.exit(1)
        except Exception:
            self.write_failure_manifest("PARSER_INTERNAL_ERROR", warning_count)
            sys.exit(1)

    def process(self) -> None:
        start_time = time.time()
        page_count, warning_count = self.run_preflight()

        # Open PDF via PDFium
        try:
            pdf = pdfium.PdfDocument(str(self.input_path))
        except Exception:
            self.write_failure_manifest("PDF_CORRUPT", warning_count)
            sys.exit(1)

        # Confirm actual page count matches
        actual_page_count = len(pdf)
        if actual_page_count != page_count:
            self.write_failure_manifest("PDF_CORRUPT", warning_count)
            sys.exit(1)

        total_extracted_chars = 0
        ocr_attempts = 0
        native_text_pages = 0
        ocr_pages = 0
        no_text_pages = 0

        for page_idx in range(actual_page_count):
            page_number = page_idx + 1
            page = pdf[page_idx]

            # 1. Page dimensions & rotation
            width_pts = float(page.get_width())
            height_pts = float(page.get_height())
            rotation = int(page.get_rotation())

            # Protect against non-finite, non-positive, or extreme dimension page bombs
            if not (math.isfinite(width_pts) and math.isfinite(height_pts) and width_pts > 0 and height_pts > 0):
                self.write_failure_manifest("PAGE_DIMENSION_EXCEEDED", warning_count)
                sys.exit(1)

            if width_pts > self.max_page_dimension_points or height_pts > self.max_page_dimension_points:
                self.write_failure_manifest("PAGE_DIMENSION_EXCEEDED", warning_count)
                sys.exit(1)

            # Protect against extreme rasterization pixel area
            scale = 2.0
            render_pixels = (width_pts * scale) * (height_pts * scale)
            if render_pixels > self.max_render_pixels_per_page:
                self.write_failure_manifest("PAGE_PIXEL_AREA_EXCEEDED", warning_count)
                sys.exit(1)

            # 2. Extract Native Text
            textpage = page.get_textpage()
            raw_native_text = textpage.get_text_range()
            normalized_native_text = normalize_text(raw_native_text)
            native_char_count = len(normalized_native_text)

            classification = "TEXT_BASED"
            extraction_method = "NATIVE"
            final_text = normalized_native_text
            final_char_count = native_char_count
            ocr_char_count = 0
            ocr_confidence = None

            # 3. Decision Boundary: Bypass OCR if sufficient native text exists
            if native_char_count >= self.min_native_chars_for_text:
                native_text_pages += 1
            else:
                # Scanned or image-heavy page requires selective OCR
                if ocr_attempts >= self.max_ocr_pages_per_document:
                    self.write_failure_manifest("PARSER_RESOURCE_LIMIT", warning_count)
                    sys.exit(1)

                ocr_attempts += 1
                temp_image_path = self.temp_dir / f"page_{page_number}_{int(time.time()*1000)}.png"

                try:
                    # Controlled rasterization at 144 DPI (scale=2.0)
                    if render_pixels > self.max_render_pixels_per_page:
                        self.write_failure_manifest("PAGE_PIXEL_AREA_EXCEEDED", warning_count)
                        sys.exit(1)

                    bitmap = page.render(scale=scale)
                    pil_image = bitmap.to_pil()
                    pil_image.save(temp_image_path, format="PNG")

                    # Run Tesseract with argument array and timeout
                    ocr_result = pytesseract.image_to_data(
                        pil_image,
                        lang="spa+eng",
                        output_type=pytesseract.Output.DICT,
                        timeout=self.ocr_page_timeout_seconds,
                    )

                    ocr_words = []
                    confidences = []
                    for word, conf in zip(ocr_result.get("text", []), ocr_result.get("conf", [])):
                        word_str = str(word).strip()
                        if word_str:
                            ocr_words.append(word_str)
                            try:
                                conf_val = float(conf)
                                if conf_val >= 0:
                                    confidences.append(conf_val)
                            except (ValueError, TypeError):
                                pass

                    raw_ocr_text = " ".join(ocr_words)
                    normalized_ocr_text = normalize_text(raw_ocr_text)
                    ocr_char_count = len(normalized_ocr_text)

                    if confidences:
                        ocr_confidence = round(sum(confidences) / len(confidences), 2)

                    # Determine hybrid, scanned, or no-text classification
                    if ocr_char_count >= 20 and native_char_count == 0:
                        classification = "SCANNED"
                        extraction_method = "OCR"
                        final_text = normalized_ocr_text
                        final_char_count = ocr_char_count
                        ocr_pages += 1
                    elif ocr_char_count >= 20 and native_char_count > 0:
                        classification = "MIXED"
                        extraction_method = "HYBRID"
                        if ocr_char_count > native_char_count:
                            final_text = normalized_ocr_text
                            final_char_count = ocr_char_count
                        else:
                            final_text = normalized_native_text
                            final_char_count = native_char_count
                        ocr_pages += 1
                    elif native_char_count > 0:
                        classification = "TEXT_BASED"
                        extraction_method = "NATIVE"
                        final_text = normalized_native_text
                        final_char_count = native_char_count
                        native_text_pages += 1
                    else:
                        classification = "NO_TEXT"
                        extraction_method = "NONE"
                        final_text = ""
                        final_char_count = 0
                        no_text_pages += 1

                except subprocess.TimeoutExpired:
                    self.write_failure_manifest("OCR_TIMEOUT", warning_count)
                    sys.exit(1)
                except RuntimeError as r_err:
                    if "timeout" in str(r_err).lower():
                        self.write_failure_manifest("OCR_TIMEOUT", warning_count)
                        sys.exit(1)
                    self.write_failure_manifest("OCR_UNAVAILABLE", warning_count)
                    sys.exit(1)
                except Exception:
                    self.write_failure_manifest("OCR_UNAVAILABLE", warning_count)
                    sys.exit(1)
                finally:
                    if temp_image_path.exists():
                        try:
                            temp_image_path.unlink()
                        except Exception:
                            pass

            # Validate per-page character bounds
            if final_char_count > self.max_extracted_chars_per_page:
                self.write_failure_manifest("PARSER_RESOURCE_LIMIT", warning_count)
                sys.exit(1)

            total_extracted_chars += final_char_count
            if total_extracted_chars > self.max_extracted_chars_per_document:
                self.write_failure_manifest("PARSER_RESOURCE_LIMIT", warning_count)
                sys.exit(1)

            # Page provenance output
            text_sha256 = compute_sha256(final_text.encode("utf-8"))
            page_data = {
                "page_number": page_number,
                "classification": classification,
                "extraction_method": extraction_method,
                "text_content": final_text,
                "char_count": final_char_count,
                "native_char_count": native_char_count,
                "ocr_char_count": ocr_char_count,
                "ocr_confidence": ocr_confidence,
                "width_points": round(width_pts, 2),
                "height_points": round(height_pts, 2),
                "rotation_degrees": rotation,
                "text_sha256": text_sha256,
            }

            page_file = self.pages_dir / f"{page_number:04d}.json"
            with open(page_file, "w", encoding="utf-8") as f:
                json.dump(page_data, f, indent=2, ensure_ascii=False)

        # Successful completion manifest
        duration_ms = int((time.time() - start_time) * 1000)
        manifest = {
            "pipeline_version": self.pipeline_version,
            "source_sha256": self.source_sha256,
            "page_count": actual_page_count,
            "structural_warning_count": warning_count,
            "native_text_page_count": native_text_pages,
            "ocr_page_count": ocr_pages,
            "no_text_page_count": no_text_pages,
            "processing_duration_ms": duration_ms,
            "error_code": None,
            "status": "SUCCEEDED",
        }

        with open(self.output_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)


def main():
    parser = argparse.ArgumentParser(description="MedStudy Atlas Secure Document Parser")
    parser.add_argument("--input", required=True, help="Path to input PDF")
    parser.add_argument("--output", required=True, help="Directory to write manifest and page files")
    parser.add_argument("--temp", required=True, help="Temporary directory for OCR rendering")
    parser.add_argument("--qpdf-path", default=None, help="Path to qpdf binary")
    parser.add_argument("--tesseract-path", default=None, help="Path to tesseract binary")
    parser.add_argument("--source-sha256", default=None, help="Pre-computed SHA-256 of the source PDF")
    parser.add_argument("--config", default=None, help="JSON string containing processing limits configuration")

    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output)
    temp_dir = Path(args.temp)

    if not input_path.exists():
        sys.stderr.write(f"Input file does not exist: {input_path}\n")
        sys.exit(1)

    doc_parser = DocumentParser(
        input_path=input_path,
        output_dir=output_dir,
        temp_dir=temp_dir,
        qpdf_path=args.qpdf_path,
        tesseract_path=args.tesseract_path,
        source_sha256=args.source_sha256,
        config_json=args.config,
    )

    doc_parser.process()


if __name__ == "__main__":
    main()
