# MedStudy Atlas — Open-Source Candidate Vetting (GitHub Scout)

## 1. Overview & Evaluation Mandate
This document records the formal **GitHub Scout** vetting of key open-source candidate repositories for MedStudy Atlas.
In accordance with our workspace rules:
- Every candidate is evaluated across license, activity, runtime footprint, operational burden, and MVP relevance.
- Permissive licenses (MIT, Apache-2.0, BSD, ISC) are preferred.
- Decisions are classified into:
  - **`ADOPT`**: High utility, permissive license, minimal overhead, immediate MVP fit.
  - **`ADAPT`**: Valuable tool requiring isolation, wrapper, or selective feature usage.
  - **`WATCH`**: Promising technology under observation; deferred past MVP to minimize premature complexity.
  - **`AVOID`**: Restrictive license, high operational burden, or simpler alternatives exist.

---

## 2. Comprehensive Candidate Vetting Records

### 1. `firecrawl/pdf-inspector`
- **Canonical Repository**: `https://github.com/firecrawl/pdf-inspector`
- **Primary Purpose**: Extremely fast (10-50ms) PDF page inspection, classification (text vs scanned vs image), and native text extraction.
- **License**: **MIT License** (Permissive, commercial SaaS compatible).
- **Current Activity**: Active maintenance by the Firecrawl team; frequent releases.
- **Maturity**: Production-proven (powers Firecrawl document scraping endpoints).
- **Runtime**: Rust core with Node.js bindings (`@firecrawl/pdf-inspector`), Python bindings, and WASM.
- **External Dependencies**: None (self-contained native binary/WASM).
- **Operational Burden**: Very Low. Can run directly inside Node.js serverless functions or lightweight workers.
- **MVP Relevance**: **HIGH**. Prevents running expensive, slow OCR on text-based medical slides.
- **Classification**: **`ADOPT`**
- **Reason**: Perfect match for the selective OCR strategy. Permissive license, low footprint, solves a concrete cost problem.

---

### 2. `docling-project/docling`
- **Canonical Repository**: `https://github.com/docling-project/docling`
- **Primary Purpose**: Comprehensive document layout understanding, complex table extraction, and structured Markdown/JSON generation.
- **License**: **MIT License** (Underlying PyTorch models have specific model licenses).
- **Current Activity**: Highly active (backed by IBM Research and open-source community).
- **Maturity**: Rapidly maturing, high community adoption.
- **Runtime**: Python, PyTorch, HuggingFace transformers.
- **External Dependencies**: Heavy Python ML ecosystem (PyTorch, layout models).
- **Operational Burden**: **HIGH**. Requires multi-GB memory footprint, slow container cold starts, and substantial CPU/GPU compute.
- **MVP Relevance**: **LOW FOR MVP**. Most medical student slides are clean enough for native extraction.
- **Classification**: **`WATCH`**
- **Reason**: Impressive capabilities for complex clinical tables, but operational burden and compute cost are excessive for the initial MVP. Revisit if student slide quality requires advanced layout parsing in a later phase.

---

### 3. `mozilla/pdf.js`
- **Canonical Repository**: `https://github.com/mozilla/pdf.js`
- **Primary Purpose**: Web standards-compliant browser PDF viewer and page renderer.
- **License**: **Apache License 2.0** (Permissive).
- **Current Activity**: Exceptionally active; the de facto standard browser PDF engine (powers Firefox).
- **Maturity**: Highly Mature / Industry Standard.
- **Runtime**: Browser JavaScript / Web Standards (Canvas, Web Workers).
- **External Dependencies**: None.
- **Operational Burden**: **ZERO** (runs entirely client-side in the user's browser).
- **MVP Relevance**: **HIGH**. Enables immediate slide viewing, interactive search, and jumping to cited pages.
- **Classification**: **`ADOPT`**
- **Reason**: Standard, robust, zero-cost client-side viewer with Apache-2.0 license.

---

### 4. `open-spaced-repetition/ts-fsrs`
- **Canonical Repository**: `https://github.com/open-spaced-repetition/ts-fsrs`
- **Primary Purpose**: Pure TypeScript implementation of the Free Spaced Repetition Scheduler (FSRS) algorithm (distinction maintained between FSRS algorithm generations and npm library versions; exact package version pinned in Phase 1H).
- **License**: **MIT License** (Permissive).
- **Current Activity**: Active maintenance by the Open Spaced Repetition research community.
- **Maturity**: Mature, widely adopted in modern spaced repetition applications.
- **Runtime**: Pure TypeScript / JavaScript.
- **External Dependencies**: Zero.
- **Operational Burden**: **ZERO**. Runs as deterministic math in milliseconds.
- **MVP Relevance**: **CRITICAL**. Powers the core flashcard scheduling and forgetting risk calculations.
- **Classification**: **`ADOPT`**
- **Reason**: Clean, tested, dependency-free implementation of the state-of-the-art spaced repetition algorithm.

---

### 5. `unclecode/crawl4ai`
- **Canonical Repository**: `https://github.com/unclecode/crawl4ai`
- **Primary Purpose**: Web crawling and HTML-to-markdown extraction optimized for LLM consumption.
- **License**: **Apache License 2.0** (Note: version 0.5.0+ includes an attribution requirement clause).
- **Current Activity**: Very active, rapid release cadence.
- **Maturity**: Emerging to Moderate.
- **Runtime**: Python, Playwright browser automation.
- **External Dependencies**: Headless Chromium, Python runtime.
- **Operational Burden**: Moderate to High (requires browser pool management).
- **MVP Relevance**: **NONE FOR MVP**. MedStudy Atlas MVP focuses exclusively on user-uploaded PDF study materials, not web scraping.
- **Classification**: **`WATCH`**
- **Reason**: Excellent candidate for future ingestion of open clinical guidelines and PubMed references, but completely out of scope for the student-upload MVP.

---

### 6. `triggerdotdev/trigger.dev`
- **Canonical Repository**: `https://github.com/triggerdotdev/trigger.dev`
- **Primary Purpose**: Background job framework with long-running tasks, retries, and checkpointing for TypeScript.
- **License**: **Apache License 2.0** (Open source engine; managed cloud offering available).
- **Current Activity**: Very active, frequent releases (v3 architecture).
- **Maturity**: Maturing rapidly.
- **Runtime**: Node.js / TypeScript.
- **External Dependencies**: Requires PostgreSQL and Trigger.dev server/worker orchestration.
- **Operational Burden**: Moderate (if self-hosted) or external cloud subscription cost.
- **MVP Relevance**: **LOW FOR MVP**. Initial background tasks (PDF chunking, Study Pack generation) can be executed via a simple PostgreSQL-backed queue table without introducing another deployment system.
- **Classification**: **`WATCH`**
- **Reason**: Excellent modern background framework. We will adopt it once background workloads exceed the capacity of a simple database-backed queue.

---

### 7. `openseadragon/openseadragon`
- **Canonical Repository**: `https://github.com/openseadragon/openseadragon`
- **Primary Purpose**: High-resolution, deep-zoom web viewer for multi-gigapixel images (e.g., histology slides).
- **License**: **BSD 3-Clause License** (Permissive).
- **Current Activity**: Stable maintenance.
- **Maturity**: Highly Mature / De facto standard for digital pathology.
- **Runtime**: Browser JavaScript.
- **External Dependencies**: None.
- **Operational Burden**: Minimal client-side burden (requires Deep Zoom / DZI tile pyramid format on server).
- **MVP Relevance**: **NONE FOR MVP** (Histology viewer is explicitly deferred).
- **Classification**: **`WATCH / LATER ADOPT`**
- **Reason**: The premier open-source tool for histology tile viewing. Reserved for future histology/pathology modules.

---

### 8. `cornerstonejs/cornerstone3D`
- **Canonical Repository**: `https://github.com/cornerstonejs/cornerstone3D`
- **Primary Purpose**: WebGL/WebGPU-accelerated medical imaging platform for 2D/3D DICOM rendering (CT, MRI, X-ray).
- **License**: **MIT License** (Permissive).
- **Current Activity**: Very active, backed by medical imaging organizations.
- **Maturity**: Highly Mature.
- **Runtime**: Browser JavaScript / TypeScript, WebGL/WebGPU.
- **External Dependencies**: DICOM parsers (`dicom-parser`).
- **Operational Burden**: High complexity in DICOM data handling and browser memory.
- **MVP Relevance**: **NONE FOR MVP** (Radiology / DICOM viewing is explicitly deferred).
- **Classification**: **`WATCH / LATER ADAPT`**
- **Reason**: Authoritative open-source foundation for medical imaging. Deferred to Phase 2+ specialized clinical modules.

---

### 9. `OHIF/Viewers`
- **Canonical Repository**: `https://github.com/OHIF/Viewers`
- **Primary Purpose**: Complete zero-footprint medical imaging workstation viewer based on Cornerstone.
- **License**: **MIT License** (Permissive).
- **Current Activity**: Active maintenance.
- **Maturity**: Enterprise/Clinical Grade.
- **Runtime**: React, Cornerstone3D.
- **External Dependencies**: PACS server / DICOMweb API.
- **Operational Burden**: Very High (full clinical workstation).
- **MVP Relevance**: **NONE FOR MVP**.
- **Classification**: **`AVOID FOR MVP`**
- **Reason**: Extreme overkill for an undergraduate study app. A lightweight viewer wrapper is preferable if DICOM is ever introduced.

---

### 10. `mrdoob/three.js`
- **Canonical Repository**: `https://github.com/mrdoob/three.js`
- **Primary Purpose**: WebGL 3D graphics rendering library.
- **License**: **MIT License** (Permissive).
- **Current Activity**: Exceptionally active, industry standard.
- **Maturity**: Highly Mature.
- **Runtime**: Browser JavaScript.
- **External Dependencies**: None.
- **Operational Burden**: Moderate (asset loading, 3D model polygon optimization).
- **MVP Relevance**: **NONE FOR MVP** (3D anatomy is explicitly deferred in Phase 0).
- **Classification**: **`WATCH / LATER ADOPT`**
- **Reason**: Standard 3D graphics foundation for future interactive anatomical model inspection.

---

### 11. `pmndrs/react-three-fiber`
- **Canonical Repository**: `https://github.com/pmndrs/react-three-fiber`
- **Primary Purpose**: Declarative React wrapper for Three.js.
- **License**: **MIT License** (Permissive).
- **Current Activity**: Very active, large ecosystem (Drei, Rapier).
- **Maturity**: Mature.
- **Runtime**: React / Next.js.
- **External Dependencies**: `three.js`.
- **Operational Burden**: Low to Moderate.
- **MVP Relevance**: **NONE FOR MVP** (3D anatomy deferred).
- **Classification**: **`WATCH / LATER ADOPT`**
- **Reason**: Natural React integration layer for Three.js when 3D anatomy is implemented.

---

### 12. `xyflow/xyflow` (React Flow)
- **Canonical Repository**: `https://github.com/xyflow/xyflow`
- **Primary Purpose**: Customizable node-based interactive diagrams, flowcharts, and knowledge maps.
- **License**: **MIT License** (Permissive).
- **Current Activity**: Exceptionally active, high quality.
- **Maturity**: Highly Mature.
- **Runtime**: React / TypeScript.
- **External Dependencies**: None.
- **Operational Burden**: Low.
- **MVP Relevance**: **NONE FOR MVP** (Graph UI is explicitly deferred; concepts are presented in list/card form in MVP).
- **Classification**: **`WATCH / LATER ADOPT`**
- **Reason**: Outstanding UI component for interactive disease pathway maps and clinical algorithm visualization in later phases.

---

### 13. `cytoscape/cytoscape.js`
- **Canonical Repository**: `https://github.com/cytoscape/cytoscape.js`
- **Primary Purpose**: Graph theory analysis and network layout visualization.
- **License**: **MIT License** (Permissive).
- **Current Activity**: Maintained.
- **Maturity**: Highly Mature (academic and bio-informatics standard).
- **Runtime**: JavaScript.
- **External Dependencies**: None.
- **Operational Burden**: Moderate (complex layout algorithms).
- **MVP Relevance**: **NONE FOR MVP** (Graph visualization deferred).
- **Classification**: **`WATCH`**
- **Reason**: Powerful for bio-informatics network analysis; React Flow is likely more suitable for user-friendly UI diagrams.

---

## 3. Synthesis: MVP Adoption Decisions

| Candidate | License | MVP Classification | Action in Phase 0C / Phase 1 |
| :--- | :--- | :--- | :--- |
| `firecrawl/pdf-inspector` | MIT | **`ADOPT`** | Integrate in document ingestion pipeline for page classification. |
| `mozilla/pdf.js` | Apache-2.0 | **`ADOPT`** | Embed in frontend for in-browser PDF viewing and citation jumps. |
| `open-spaced-repetition/ts-fsrs` | MIT | **`ADOPT`** | Integrate in learning engine for FSRS spaced repetition scheduling. |
| `docling-project/docling` | MIT | **`WATCH`** | Defer. Evaluate in Phase 2 if complex table extraction is required. |
| `triggerdotdev/trigger.dev` | Apache-2.0 | **`WATCH`** | Defer. Use simple PostgreSQL queue table for MVP. |
| `unclecode/crawl4ai` | Apache-2.0 | **`WATCH`** | Defer. Not relevant to student PDF upload loop. |
| `openseadragon` | BSD-3-Clause | **`LATER ADOPT`** | Defer to Histology module (Phase 2+). |
| `cornerstonejs/cornerstone3D` | MIT | **`LATER ADAPT`** | Defer to Radiology / DICOM module (Phase 3+). |
| `OHIF/Viewers` | MIT | **`AVOID FOR MVP`** | Defer / Avoid. Overkill for educational study app. |
| `three.js` | MIT | **`LATER ADOPT`** | Defer to 3D Anatomy module (Phase 2+). |
| `react-three-fiber` | MIT | **`LATER ADOPT`** | Defer to 3D Anatomy module (Phase 2+). |
| `xyflow/xyflow` | MIT | **`LATER ADOPT`** | Defer to Visual Knowledge Graph UI (Phase 2+). |
| `cytoscape.js` | MIT | **`WATCH`** | Defer. React Flow preferred for interactive study UI. |
