# MedStudy Atlas — Build vs. OSS vs. API / SaaS Evaluation

## 1. Overview & Evaluation Framework
Before building custom components or integrating third-party services, MedStudy Atlas systematically evaluates candidates against the **OSS / GitHub-First Evaluation Order**:
1. Existing stack capability (PostgreSQL, Next.js);
2. Mature, permissively licensed open-source project;
3. Simple deterministic in-house implementation;
4. Free or low-cost external API;
5. Custom or self-hosted complex infrastructure only when strictly justified.

### Total Cost of Ownership (TCO) Standard
Open source is **not automatically free**. Self-hosting complex services introduces maintenance, CPU/GPU, storage, patching, and operational overhead that often exceeds the cost of a managed API. Every item is evaluated for true TCO.

---

## 2. Comprehensive Subsystem Evaluation Matrix

| Subsystem | Problem Solved | Build Option | OSS Option | API / SaaS Option | License | Impl. Complexity | Ops Complexity | Cost Type | Maint. Burden | Recommendation | Classification |
| **Authentication** | User identity, sessions, password reset, social login | Custom JWT & bcrypt in Next.js | NextAuth / Auth.js (ISC) | Supabase Auth (MIT / Managed) | ISC / MIT | Moderate | Low | Managed Tier (PRICE / LIMIT MUST BE VERIFIED FROM OFFICIAL SOURCE BEFORE ADOPTION) | Low | Use Supabase Auth; native integration with Postgres RLS. | **ADOPT (Supabase Auth)** |
| **Database** | Relational data, ACID transactions, data persistence | N/A | PostgreSQL (PostgreSQL License) | Supabase Managed Postgres | PostgreSQL | Low | Low (Managed) | Managed Tier (PRICE / LIMIT MUST BE VERIFIED FROM OFFICIAL SOURCE BEFORE ADOPTION) | Low | Use Supabase PostgreSQL. Single system of record. | **ADOPT (Supabase Postgres)** |
| **Vector Search** | Semantic similarity search for RAG | Brute-force cosine in JS | `pgvector` extension for PostgreSQL | Pinecone, Qdrant, Weaviate | PostgreSQL / Apache-2.0 | Low | Low | In-database ($0 extra) | Minimal | Use `pgvector` inside PostgreSQL. Avoid dedicated vector DB. | **ADOPT (pgvector)** |
| **File Storage** | Storing user PDFs and slide assets | Local disk storage (not cloud-ready) | MinIO (AGPL-3.0 - copyleft issue) | Supabase Storage / Cloudflare R2 | S3 API / Commercial | Low | Low | Storage / Egress (PRICE / LIMIT MUST BE VERIFIED FROM OFFICIAL SOURCE BEFORE ADOPTION) | Low | Use Supabase Storage or Cloudflare R2 (S3-compatible; verify pricing/egress before adoption). | **ADOPT (Supabase Storage / R2)** |
| **PDF Viewer** | Browser document viewing & highlight citations | HTML `<canvas>` from scratch | `mozilla/pdf.js` | PSPDFKit, Adobe PDF Embed | Apache-2.0 | Low | None (Client-side) | Free ($0) | Low | Embed `pdf.js` for client-side rendering and citation jumping. | **ADOPT (pdf.js)** |
| **PDF Classifier** | Rapid page categorization (text vs scanned) | Custom PDF parser | `firecrawl/pdf-inspector` | Cloud Document AI | MIT | Low | Low (WASM / Node binding) | Free ($0) | Low | Use `pdf-inspector` to route only scanned pages to OCR. | **ADOPT (pdf-inspector)** |
| **Document Parser** | Deep layout & table extraction | Regex / string parsing | `docling-project/docling` | AWS Textract, Google Document AI | MIT | High | High (PyTorch runtime) | Compute / API costs | High | Defer Docling for MVP. Use lightweight native extraction initially. | **WATCH / DEFER (Docling)** |
| **OCR** | Extract text from scanned slides and image pages | N/A | Tesseract 5 / PaddleOCR | Google Cloud Vision OCR / Mistral OCR | Apache-2.0 | Moderate | Moderate (Worker runtime) | Compute vs API (PRICE / LIMIT MUST BE VERIFIED) | Moderate | Use Tesseract in worker for selective pages; API as strict fallback. | **ADAPT (Tesseract)** |
| **Spaced Repetition** | Calculating memory decay and optimal review intervals | Custom SM-2 algorithm | `open-spaced-repetition/ts-fsrs` | AnkiConnect | MIT | Low | None (Pure TS math) | Free ($0) | Minimal | Adopt `ts-fsrs` directly in the Next.js runtime. | **ADOPT (ts-fsrs)** |
| **RAG Retrieval** | Hybrid lexical + semantic context search | Custom search server | Postgres FTS (`tsvector`) + `pgvector` | ElasticSearch, Pinecone | PostgreSQL | Low | Low (In-database) | Free ($0 extra) | Low | Native PostgreSQL hybrid query with RRF. | **ADOPT (Postgres RAG)** |
| **Reranking** | Post-retrieval relevance scoring | N/A | Cross-encoder models (FlashRank) | Cohere Rerank API | Apache-2.0 / Commercial | Moderate | Low | API per call (PRICE / LIMIT MUST BE VERIFIED) | Low | Avoid for MVP. Heuristic scoring in SQL is sufficient. | **AVOID / DEFER** |
| **Background Jobs** | Async PDF processing and Study Pack generation | In-memory `setTimeout` (unreliable) | BullMQ (Redis needed) / `trigger.dev` | Trigger.dev Cloud / Inngest | MIT / Apache-2.0 | Low | Low to Moderate | DB storage vs Cloud | Low | Use a PostgreSQL-backed job queue table for MVP. | **ADOPT (Postgres Queue)** |
| **Product Analytics** | Track activation, retention, learning milestones | Custom DB logging | PostHog (Open-Source / Cloud) | Mixpanel, Amplitude | MIT / Commercial | Low | Low | Free / Managed tier (PRICE / LIMIT MUST BE VERIFIED FROM OFFICIAL SOURCE BEFORE ADOPTION) | Low | Use simple DB events + lightweight PostHog / client telemetry. | **ADOPT (PostHog / DB Events)** |
| **Transactional Email** | Password resets, study reminders | SMTP server (high spam risk) | Nodemailer (requires SMTP relay) | Resend, Postmark | MIT / Commercial | Low | None (API) | Free / Pay-as-you-go (PRICE / LIMIT MUST BE VERIFIED FROM OFFICIAL SOURCE BEFORE ADOPTION) | Low | Use Resend or Postmark API for verified deliverability. | **ADOPT (Resend/Postmark)** |
| **Billing & Payments** | Subscriptions and local payments (Peru/LATAM) | Custom billing logic (unsafe) | Kill Bill (Java - heavy enterprise) | Mercado Pago, Stripe | Commercial | Moderate | Low | Gateway % fee (PRICE / LIMIT MUST BE VERIFIED) | Moderate | Provider-neutral billing module; integrate Mercado Pago/Stripe later. | **ADOPT (Mercado Pago/Stripe API)** |
| **Rate Limiting** | Prevent API and AI cost abuse | In-memory token bucket | Upstash Redis `@upstash/ratelimit` | Cloudflare WAF Rate Limiting | MIT / Commercial | Low | Low | Free / Usage tier (PRICE / LIMIT MUST BE VERIFIED FROM OFFICIAL SOURCE BEFORE ADOPTION) | Minimal | Use database/in-memory rate limiting initially; Upstash later. | **ADOPT (DB/Upstash)** |
| **Observability & Logs** | Error tracking and telemetry | Console.log | OpenTelemetry / SigNoz | Sentry, Axiom, Better Stack | Commercial / MIT | Low | Low | Free / Developer tier (PRICE / LIMIT MUST BE VERIFIED FROM OFFICIAL SOURCE BEFORE ADOPTION) | Low | Use Sentry for runtime errors; log AI telemetry to Postgres `ai_usages`. | **ADOPT (Sentry + Postgres)** |

---

## 3. Key Decision Summary

1. **Leverage PostgreSQL Fully**: By utilizing PostgreSQL for Relational Data + Concept Graph + Full-Text Search + `pgvector` + Background Job Queue, we eliminate four separate external SaaS/infrastructure dependencies (Neo4j, Pinecone, Redis, and ElasticSearch).
2. **Deterministic & Permissive OSS**: `ts-fsrs` (MIT), `pdf-inspector` (MIT), and `pdf.js` (Apache-2.0) provide core intelligence and viewing without ongoing licensing fees or heavy server-side ML runtimes.
3. **Managed Auth & Storage**: Supabase Auth and Supabase Storage/R2 offload security-critical identity and asset storage at near-zero starting cost.
