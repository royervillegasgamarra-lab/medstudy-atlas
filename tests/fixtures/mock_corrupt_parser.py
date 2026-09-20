#!/usr/bin/env python3
"""
Mock parser script used exclusively in tests for [PROC-29].
Simulates a parser that successfully exits with code 0 and a valid manifest claiming 2 pages,
but emits corrupted JSON for page 2.
"""
import argparse
import json
import sys
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Mock Parser for PROC-29")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--temp", required=True)
    parser.add_argument("--qpdf-path", default=None)
    parser.add_argument("--tesseract-path", default=None)
    parser.add_argument("--source-sha256", default=None)
    parser.add_argument("--config", default=None)

    args = parser.parse_args()
    out_dir = Path(args.output)
    pages_dir = out_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "pipeline_version": "1.0.0",
        "source_sha256": args.source_sha256 or "mock_sha",
        "page_count": 2,
        "structural_warning_count": 0,
        "native_text_page_count": 2,
        "ocr_page_count": 0,
        "no_text_page_count": 0,
        "processing_duration_ms": 50,
        "status": "SUCCEEDED",
        "error_code": None,
    }
    with open(out_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # Valid page 1
    page1 = {
        "page_number": 1,
        "classification": "TEXT_BASED",
        "extraction_method": "NATIVE",
        "text_content": "Valid page 1 text",
        "char_count": 17,
        "native_char_count": 17,
        "ocr_char_count": 0,
        "ocr_confidence": None,
        "width_points": 612,
        "height_points": 792,
        "rotation_degrees": 0,
        "text_sha256": "4b68e9196b026da6e655ba622c1db4b23838e11a141b4e5bbefb51e0ffbc4fc2",
    }
    with open(pages_dir / "0001.json", "w", encoding="utf-8") as f:
        json.dump(page1, f, indent=2)

    # Corrupt page 2 (invalid JSON)
    with open(pages_dir / "0002.json", "w", encoding="utf-8") as f:
        f.write("{ INVALID_JSON_CORRUPTED: 123")

    sys.exit(0)

if __name__ == "__main__":
    main()
