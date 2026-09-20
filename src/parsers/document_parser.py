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
- Runs in a sandboxed subprocess with zero Supabase, DB, or AI credentials.
- Bounded resource budgets enforced before expensive operations.
- Render pixel limits enforced prior to bitmap rasterization.
- Prompt injection text is extracted as inert USER_DOCUMENT_UNTRUSTED data.
- Temporary files guaranteed removed in finally blocks.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pypdfium2 as pdfium
import pytesseract
from PIL import Image

# Centralized default limits (mirrors src/config/processing-limits.ts)
MAX_PAGES_PER_DOCUMENT = 300
MAX_OCR_PAGES_PER_DOCUMENT = 60
MAX_EXTRACTED_CHARS_PER_PAGE = 100_000
MAX_EXTRACTED_CHARS_PER_DOCUMENT = 3_000_000
MAX_RENDER_PIXELS_PER_PAGE = 12_000_000
PREFLIGHT_TIMEOUT_SECONDS = 10
NATIVE_PAGE_EXTRACTION_TIMEOUT_SECONDS = 5
OCR_PAGE_TIMEOUT_SECONDS = 20
MIN_NATIVE_CHARS_FOR_TEXT = 50
PIPELINE_VERSION = "1.0.0"


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
    # Standardize newlines
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Filter non-printable control characters (allow \n (10) and \t (9))
    filtered_chars = []
    for c in text:
        code = ord(c)
        if code == 0:
            continue
        if code < 32 and code not in (9, 10):
            continue
        filtered_chars.append(c)
    normalized = "".join(filtered_chars)
    # Strip trailing whitespace on each line
    lines = [line.rstrip() for line in normalized.split("\n")]
    return "\n".join(lines).strip()


def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compute_file_sha256(file_path: Path) -> str:
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


class DocumentParser:
    def __init__(
        self,
        input_path: Path,
        output_dir: Path,
        temp_dir: Path,
        qpdf_path: Optional[str] = None,
        tesseract_path: Optional[str] = None,
        source_sha256: Optional[str] = None,
    ):
        self.input_path = input_path
        self.output_dir = output_dir
        self.temp_dir = temp_dir
        self.pages_dir = output_dir / "pages"
        self.qpdf_path = qpdf_path or shutil.which("qpdf") or "qpdf"
        self.tesseract_path = tesseract_path or shutil.which("tesseract") or "tesseract"
        self.source_sha256 = source_sha256 or compute_file_sha256(input_path)

        if tesseract_path and os.path.exists(tesseract_path):
            pytesseract.pytesseract.tesseract_cmd = tesseract_path

        self.pages_dir.mkdir(parents=True, exist_ok=True)
        self.temp_dir.mkdir(parents=True, exist_ok=True)

    def write_failure_manifest(self, error_code: str, warning_count: int = 0) -> None:
        manifest = {
            "pipeline_version": PIPELINE_VERSION,
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
        """
        Runs qpdf checks:
        1. Encryption detection: qpdf --is-encrypted
        2. Structural corruption: qpdf --check
        3. Page count: qpdf --show-npages

        Returns: (page_count, warning_count)
        """
        # 1. Check Encryption
        try:
            res_enc = subprocess.run(
                [self.qpdf_path, "--is-encrypted", str(self.input_path)],
                capture_output=True,
                text=True,
                timeout=PREFLIGHT_TIMEOUT_SECONDS,
                shell=False,
            )
            # Exit code 0 means encrypted
            if res_enc.returncode == 0:
                self.write_failure_manifest("PDF_ENCRYPTED")
                sys.exit(1)
        except subprocess.TimeoutExpired:
            self.write_failure_manifest("PREFLIGHT_TIMEOUT")
            sys.exit(1)
        except Exception as e:
            # If qpdf is unavailable or fails to spawn
            self.write_failure_manifest("PARSER_CRASH")
            sys.exit(1)

        # 2. Structural Check & Warnings
        warning_count = 0
        try:
            res_check = subprocess.run(
                [self.qpdf_path, "--check", str(self.input_path)],
                capture_output=True,
                text=True,
                timeout=PREFLIGHT_TIMEOUT_SECONDS,
                shell=False,
            )
            # qpdf exit codes: 0 = clean, 3 = warnings, 2 = errors
            if res_check.returncode == 2:
                self.write_failure_manifest("PDF_CORRUPT")
                sys.exit(1)
            elif res_check.returncode == 3:
                warning_count = len([line for line in res_check.stderr.splitlines() if "WARNING" in line.upper()])
                if warning_count == 0:
                    warning_count = 1
        except subprocess.TimeoutExpired:
            self.write_failure_manifest("PREFLIGHT_TIMEOUT")
            sys.exit(1)

        # 3. Page Count
        try:
            res_pages = subprocess.run(
                [self.qpdf_path, "--show-npages", str(self.input_path)],
                capture_output=True,
                text=True,
                timeout=PREFLIGHT_TIMEOUT_SECONDS,
                shell=False,
            )
            if res_pages.returncode not in (0, 3):
                self.write_failure_manifest("PDF_CORRUPT", warning_count)
                sys.exit(1)

            page_count = None
            for line in [l.strip() for l in res_pages.stdout.splitlines() if l.strip()]:
                if line.isdigit():
                    page_count = int(line)
                    break

            if page_count is None:
                self.write_failure_manifest("PDF_CORRUPT", warning_count)
                sys.exit(1)

            if page_count == 0:
                self.write_failure_manifest("PDF_ZERO_PAGES", warning_count)
                sys.exit(1)

            if page_count > MAX_PAGES_PER_DOCUMENT:
                self.write_failure_manifest("PAGE_LIMIT_EXCEEDED", warning_count)
                sys.exit(1)

            return page_count, warning_count

        except subprocess.TimeoutExpired:
            self.write_failure_manifest("PREFLIGHT_TIMEOUT", warning_count)
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

            # Protect against extreme dimension page bombs
            if (width_pts * height_pts) > MAX_RENDER_PIXELS_PER_PAGE:
                self.write_failure_manifest("PAGE_RENDER_LIMIT", warning_count)
                sys.exit(1)

            # 2. Extract native text
            textpage = page.get_textpage()
            raw_native_text = textpage.get_text_range()
            normalized_native_text = normalize_text(raw_native_text)
            native_char_count = len(normalized_native_text)

            # Check single page text limit
            if native_char_count > MAX_EXTRACTED_CHARS_PER_PAGE:
                self.write_failure_manifest("TEXT_PAGE_LIMIT", warning_count)
                sys.exit(1)

            final_text = normalized_native_text
            final_char_count = native_char_count
            ocr_char_count = 0
            ocr_confidence: Optional[float] = None
            classification = "TEXT_BASED"
            extraction_method = "NATIVE"

            # 3. Decide whether OCR is required
            if native_char_count >= MIN_NATIVE_CHARS_FOR_TEXT:
                classification = "TEXT_BASED"
                extraction_method = "NATIVE"
                native_text_pages += 1
            else:
                # Page requires OCR
                ocr_pages += 1
                if ocr_pages > MAX_OCR_PAGES_PER_DOCUMENT:
                    self.write_failure_manifest("OCR_PAGE_LIMIT", warning_count)
                    sys.exit(1)

                # 4. Render safety calculation
                scale = 2.0  # 144 DPI
                rendered_width = width_pts * scale
                rendered_height = height_pts * scale
                total_pixels = rendered_width * rendered_height

                if total_pixels > MAX_RENDER_PIXELS_PER_PAGE:
                    # Scale down if possible
                    max_scale = (MAX_RENDER_PIXELS_PER_PAGE / (width_pts * height_pts)) ** 0.5
                    if max_scale < 1.0:
                        self.write_failure_manifest("PAGE_RENDER_LIMIT", warning_count)
                        sys.exit(1)
                    scale = max_scale

                # Render page to temporary image
                temp_image_path = self.temp_dir / f"page_{page_number:04d}.png"
                try:
                    bitmap = page.render(scale=scale)
                    pil_image = bitmap.to_pil()
                    pil_image.save(temp_image_path, format="PNG")

                    # Run Tesseract with argument array and timeout
                    ocr_result = pytesseract.image_to_data(
                        pil_image,
                        lang="spa+eng",
                        output_type=pytesseract.Output.DICT,
                        timeout=OCR_PAGE_TIMEOUT_SECONDS,
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

                    # Determine hybrid or scanned classification
                    if ocr_char_count >= 20 and native_char_count == 0:
                        classification = "SCANNED"
                        extraction_method = "OCR"
                        final_text = normalized_ocr_text
                        final_char_count = ocr_char_count
                    elif ocr_char_count >= 20 and native_char_count > 0:
                        classification = "MIXED"
                        extraction_method = "HYBRID"
                        # Use the richer text source
                        if ocr_char_count > native_char_count:
                            final_text = normalized_ocr_text
                            final_char_count = ocr_char_count
                        else:
                            final_text = normalized_native_text
                            final_char_count = native_char_count
                    elif native_char_count > 0:
                        classification = "TEXT_BASED"
                        extraction_method = "NATIVE"
                        final_text = normalized_native_text
                        final_char_count = native_char_count
                    else:
                        classification = "NO_TEXT"
                        extraction_method = "NONE"
                        final_text = ""
                        final_char_count = 0
                        no_text_pages += 1

                except subprocess.TimeoutExpired:
                    self.write_failure_manifest("OCR_TIMEOUT", warning_count)
                    sys.exit(1)
                except Exception as ocr_err:
                    self.write_failure_manifest("OCR_UNAVAILABLE", warning_count)
                    sys.exit(1)
                finally:
                    # Guaranteed immediate cleanup of temporary page image
                    if temp_image_path.exists():
                        try:
                            temp_image_path.unlink()
                        except Exception:
                            pass

            # Update document character total
            total_extracted_chars += final_char_count
            if total_extracted_chars > MAX_EXTRACTED_CHARS_PER_DOCUMENT:
                self.write_failure_manifest("TEXT_DOCUMENT_LIMIT", warning_count)
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
            "pipeline_version": PIPELINE_VERSION,
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
    )

    doc_parser.process()


if __name__ == "__main__":
    main()
