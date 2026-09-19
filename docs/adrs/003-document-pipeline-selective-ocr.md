# ADR 003: Document Ingestion Pipeline and Selective OCR Strategy

## Status
`ACCEPTED`

## Context
Medical students upload syllabi, guidelines, and lecture slide decks (mostly PDF format). These documents range from cleanly exported digital presentations to scanned handouts and photographic slides. Full-page OCR across every uploaded PDF is prohibitively slow and expensive. We need an efficient, cost-effective ingestion pipeline that extracts text and structure while keeping compute costs minimal.

## Decision Drivers
- **Processing Speed**: Students expect study materials to be processed within 1–2 minutes.
- **Compute Cost**: Prevent runaway OCR server costs on 100-page slide decks.
- **Provenance Accuracy**: Maintain page numbers and character/coordinate references for citation grounding.

## Options Considered
1. **Selective OCR Pipeline (`pdf-inspector` + Native Extraction + Targeted OCR + `pdf.js`)**:
   - *Pros*: Fast first-pass inspection classifies each page (10–50ms); native text is extracted directly with zero OCR overhead; OCR runs only on pages classified as `SCANNED` or `IMAGE_BASED`; `pdf.js` renders in browser with zero server rendering costs.
   - *Cons*: Scanned pages with unusual orientations or very poor handwriting may require specialized processing.
2. **Universal OCR (Run Tesseract or Cloud OCR on Every Page)**:
   - *Pros*: Uniform pipeline for all documents.
   - *Cons*: Immensely slow (3–5 seconds per page = 5–8 minutes per slide deck); massive CPU consumption or variable cloud OCR API bills (PRICE / LIMIT MUST BE VERIFIED FROM OFFICIAL SOURCE BEFORE ADOPTION).
3. **Heavyweight Multi-Modal Document Parser (`docling-project/docling`)**:
   - *Pros*: Deep table and layout extraction via PyTorch vision models.
   - *Cons*: Requires multi-GB memory, slow cold starts, heavy GPU/CPU overhead; premature for initial MVP slide decks.

## Decision
**ADOPT Option 1**: Implement a **Selective OCR Pipeline**:
- **First-Pass Classification**: Use `firecrawl/pdf-inspector` (MIT) to classify each page as `TEXT_BASED`, `SCANNED`, `IMAGE_BASED`, or `MIXED`.
- **Native Text Extraction**: Extract text streams directly for all `TEXT_BASED` pages.
- **Targeted OCR**: Run local Tesseract 5 only on `SCANNED` or `IMAGE_BASED` pages.
- **Cloud OCR Fallback**: Restrict cloud API OCR (e.g. Vision/Textract) to PRO users as an explicit fallback up to a strict cap.
- **Client-Side Viewer**: Embed `mozilla/pdf.js` (Apache-2.0) for in-browser PDF viewing and citation jumping.
- **Defer Docling**: Keep `docling` on `WATCH` for Phase 2+ if complex table extraction is required.

## Consequences
### Positive
- `pdf-inspector` enables page-level selective OCR and the actual bypass rate will be measured empirically from uploaded medical-study PDFs.
- Compute costs per document are minimized by extracting digital text directly and invoking OCR only on scanned/image-based pages.
- Client-side rendering via `pdf.js` eliminates server-side page-image generation overhead.

### Negative / Trade-offs
- Low-quality scanned handouts with faint text will have lower extraction accuracy unless routed to OCR.
- *Mitigation*: The system detects low word counts on scanned pages and prompts the student to confirm OCR processing.

## Reversibility & Migration Path
The extraction and OCR stages are decoupled behind the `DocumentModule` interface. If Docling or another layout engine is adopted later, it can be plugged into the processing pipeline without affecting chunking or RAG storage.

## Date
2026-09-19
