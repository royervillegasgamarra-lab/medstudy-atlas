# MedStudy Atlas — AI Architecture, Telemetry & Cost Control

## 1. Architectural Philosophy: Small Abstraction, Single Provider Start
MedStudy Atlas avoids complicated multi-agent swarms, dynamic multi-provider routing, and heavy orchestration frameworks (LangChain, LlamaIndex, CrewAI) for the MVP:
- **Thin `AIProvider` Abstraction**: A single internal TypeScript interface isolates all LLM calls. The application can swap providers or models by changing an environment variable without modifying business logic.
- **Single Provider at Launch**: Start with ONE reliable, cost-effective provider (e.g., OpenAI `gpt-4o-mini` / `text-embedding-3-small`, or Google Gemini `gemini-1.5-flash`).
- **Strict Deterministic Guardrails**: Maximize deterministic code for all non-generative logic.

---

## 2. The `AIProvider` Interface

```typescript
export interface AICompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json_object';
  jsonSchema?: Record<string, unknown>;
  userId: string;
  feature: 'STUDY_PACK_GEN' | 'STUDY_PACK_VERIFY' | 'TUTOR_CHAT' | 'QUESTION_GEN' | 'SUMMARY' | 'EMBEDDING' | 'BENCHMARK';
  documentId?: string;
}

export interface AITelemetry {
  provider: string;
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  status: 'SUCCESS' | 'FAILED' | 'RATE_LIMITED';
  userId?: string;
  documentId?: string;
}

export interface AIProvider {
  readonly providerId: string;
  generateStructured<T>(prompt: string, schema: Record<string, unknown>, options: AICompletionOptions): Promise<{ data: T; telemetry: AITelemetry }>;
  generateStream(messages: Array<{ role: string; content: string }>, options: AICompletionOptions): AsyncIterable<{ chunk: string; telemetry?: AITelemetry }>;
  generateEmbedding(text: string, options: { userId: string }): Promise<{ embedding: number[]; telemetry: AITelemetry }>;
}
```

### 2.1 Provider Implementations (Implemented in Phase 1E)
1. **`MockAIProvider` (`src/modules/ai/mock-provider.ts`)**:
   - Deterministic test provider returning valid structured study pack objects grounded in document text.
   - Computes realistic token estimates ($0.00 cost) with zero external network requests.
   - Powers 100% of automated unit tests, integration tests, E2E tests, and benchmark runs during development.
2. **`OpenAICompatibleProvider` (`src/modules/ai/openai-compatible-provider.ts`)**:
   - Production-ready client targeting OpenAI or any OpenAI-compatible gateway (e.g. LiteLLM, Ollama, vLLM).
   - Configurable via `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL`.
   - Respects structured outputs via JSON schema mode (`response_format: { type: 'json_object' }`).
3. **Provider Factory (`src/modules/ai/provider-factory.ts`)**:
   - Safely instantiates `MockAIProvider` when `AI_PROVIDER === 'mock'` or in `NODE_ENV === 'test'`.
   - Prevents accidental remote calls or unexpected cloud spend during test execution.

---

## 3. Deterministic-First AI Policy

To maintain profitability at ~S/ 10/month (~$2.70 USD), the system enforces an explicit **Deterministic-First Policy**: **Never use an LLM when deterministic code can achieve the result.**

### Task Inventory: Deterministic vs. AI-Assisted

| Task | Execution Mode | Mechanism | Rationale |
| :--- | :--- | :--- | :--- |
| **Spaced Repetition Scheduling** | **DETERMINISTIC** | `ts-fsrs` mathematical formulas | Exact, zero token cost, instant. |
| **Today Plan Prioritization** | **DETERMINISTIC** | Weighted ranking formula | Interpretable, zero token cost. |
| **Document Classification** | **DETERMINISTIC** | `pdf-inspector` (Rust/WASM) | Fast byte/structure inspection (<50ms). |
| **Page Counting & Metadata** | **DETERMINISTIC** | Native PDF parser | Zero LLM requirement. |
| **Document Deduplication** | **DETERMINISTIC** | SHA-256 hash | Exact matching, zero cost. |
| **Quota & Entitlement Check** | **DETERMINISTIC** | PostgreSQL query | Absolute transactional guarantee. |
| **Analytics & Mastery Aggregation** | **DETERMINISTIC** | SQL aggregate functions / formulas | Mathematically verified. |
| **Billing State Reconciliation** | **DETERMINISTIC** | Gateway webhook verification | Exact financial accounting. |
| **Study Pack Generation** | **AI-ASSISTED** | LLM with JSON Schema (2-call verification) | Generates structured summaries, MCQs, cards. |
| **Context-Grounded Tutor** | **AI-ASSISTED** | LLM with retrieved context chunks | Synthesizes answers with citations. |
| **Vector Embeddings** | **AI-ASSISTED** | Embedding model (Phase 1F) | Generates dense semantic vectors. |

---

## 4. AI Cost Control & Unit Economics Risk Analysis

### Symbolic Unit Economics Framework

> **Core Commercial Hypothesis**: At a target monthly subscription price of ~S/ 10.00 (~$2.70 USD), commercial viability requires maintaining a healthy gross margin. **Profitability is an explicit hypothesis to be empirically validated during MVP rollout; exact provider pricing must be verified before purchase.**

The unit economics per active paying student are modeled symbolically:

$$\text{NetContribution} = \text{subscriptionRevenue} - (\text{paymentFee} + \text{infraCost} + \text{aiCost} + \text{storageCost})$$

$$\text{GrossMargin} = \frac{\text{NetContribution}}{\text{subscriptionRevenue}} \ge \text{grossMarginTarget}$$

Where:
- **`subscriptionRevenue`**: ~S/ 10.00 / month (~$2.70 USD / month) (`INITIAL CONFIGURABLE ASSUMPTION`).
- **`grossMarginTarget`**: $\ge 70\%$ (`INITIAL CONFIGURABLE ASSUMPTION`).
- **`paymentFee`**: Gateway transaction processing commission (% + fixed fee, verified per gateway).
- **`infraCost`**: Amortized compute, database, and connection pooling cost per active user.
- **`storageCost`**: Private document and rendered page storage in S3/R2/Supabase.
- **`aiCost`**: Aggregate monthly LLM and embedding inference cost:
  $$\text{aiCost} = \sum_{\text{ops}} \left( N_{\text{input\_tokens}} \cdot P_{\text{input}} + N_{\text{output\_tokens}} \cdot P_{\text{output}} + N_{\text{cached\_tokens}} \cdot P_{\text{cached}} \right)$$
- **Max Allowable Variable Cost**:
  $$\text{paymentFee} + \text{infraCost} + \text{aiCost} + \text{storageCost} \le \text{subscriptionRevenue} \cdot (1 - \text{grossMarginTarget}) \approx \$0.80 \text{ USD / month}$$

### 4.1 Token Pricing & Telemetry Calculation (`pricing.ts`)
The cost engine calculates:
$$\text{uncachedInput} = \max(0, \text{inputTokens} - \text{cachedTokens})$$
$$\text{cost} = (\text{uncachedInput} \cdot P_{\text{input}}) + (\text{cachedTokens} \cdot P_{\text{cached}}) + (\text{outputTokens} \cdot P_{\text{output}})$$
All operations are logged to `public.ai_usages` with `estimated_cost_usd` tracked to 6 decimal places.

### Hard Cost Controls Matrix (Configurable Safeguards)
1. **Hard Token Ceilings** (`INITIAL CONFIGURABLE ASSUMPTION`):
   - Tutor Query (Phase 1F): Max 1,500 input context tokens + max 500 completion tokens.
   - Study Pack (Phase 1E): Max candidate tokens: 4,096, max verifier tokens: 2,048 (`STUDY_PACK_WORKER_LIMITS`), input evidence bounded by `maxEvidenceChars`: 100,000 and `maxEvidenceChunks`: 80 (`STUDY_PACK_BUDGET_LIMITS`).
2. **Feature Quotas (Enforced in Database)** (`INITIAL CONFIGURABLE ASSUMPTION`):
   - Free Tier: Max 5 document uploads/month, max 10 Tutor messages/day, 1 Study Pack/document.
   - PRO Tier: Max 50 document uploads/month, max 50 Tutor messages/day.
3. **Generation Caching**:
   - A Study Pack is generated **once** upon request and stored in PostgreSQL (`study_packs`). It is served from database cache on subsequent page views with zero AI provider calls.
4. **Prompt Caching**:
   - Leverage provider prompt caching (tracked via `cached_tokens` in `ai_usages`) for static medical system prompts.
5. **Spend Telemetry & Circuit Breaker Tracking**:
   - All token consumption and estimated costs are logged to `public.ai_usages` with composite foreign keys to user and document/study pack. Per-call tokens are strictly capped, provider timeouts are enforced with `AbortSignal`, and worker retries are bounded to 3 attempts.

---

## 5. Phase 1E: Synthetic Medical Lecture Benchmark Harness

MedStudy Atlas provides an opt-in developer benchmark harness (`src/benchmarks/study-pack-benchmark.ts`) to evaluate study pack generation pipelines against realistic medical lecture transcripts:

```bash
# Run benchmark suite across all synthetic medical fixtures
pnpm ai:benchmark:study-pack
```

### Benchmark Fixtures (`tests/fixtures/benchmark/`):
1. `anatomy-neuro.json`: Cranial nerves and brainstem neuroanatomy.
2. `physiology-cardio.json`: Cardiac cycle, pressures, and Wiggers diagram concepts.
3. `pharmacology-antibiotics.json`: Beta-lactams, macrolides, and resistance mechanisms.
4. `pathology-pulmonary.json`: Obstructive vs. restrictive lung diseases.
5. `bilingual-lecture.json`: Mixed Spanish-English clinical slide terminology.

### Verified Benchmark Metrics:
- **Parse & Chunk Time**: $\le 100$ms per fixture.
- **Verification Ratio**: $\ge 80\%$ supported claims across fixtures.
- **QA Pass Rate**: 100% (5/5 fixtures passing quality criteria).
- **Cost**: $0.00 using local `MockAIProvider`.

