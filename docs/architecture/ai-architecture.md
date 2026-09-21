# MedStudy Atlas — AI Architecture, Telemetry & Cost Control

## 1. Architectural Philosophy: Small Abstraction, Single Provider Start
MedStudy Atlas avoids complicated multi-agent swarms, dynamic multi-provider routing, and heavy orchestration frameworks (LangChain, LlamaIndex, CrewAI) for the MVP:
- **Thin `AIProvider` Abstraction**: A single internal TypeScript interface isolates all LLM calls. The application can swap providers or models by changing an environment variable without modifying business logic.
- **Single Provider at Launch**: Start with ONE reliable, cost-effective provider (e.g., OpenAI `gpt-4o-mini` / `text-embedding-3-small`, or Google Gemini `gemini-1.5-flash`).
- **Strict Deterministic Guardrails**: Maximize deterministic code for all non-generative logic.

---

## 2. The `AIProvider` Interface (Implemented in Phase 1E)

In Phase 1E, the `AIProvider` abstraction implements strictly a single domain method: `generateStructured()`. Streaming and embeddings are explicitly deferred to subsequent phases.

```typescript
export interface AIStructuredRequest<T> {
  schema: z.ZodType<T>;
  schemaName: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
}

export interface AICompletionTelemetry {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  status: "SUCCESS" | "FAILED" | "RATE_LIMITED";
}

export interface AIStructuredResult<T> {
  data: T;
  telemetry: AICompletionTelemetry;
}

export interface AIRequestContext {
  userId?: string;
  documentId?: string;
  studyPackId?: string;
  feature?: "STUDY_PACK_GEN" | "STUDY_PACK_VERIFY" | "BENCHMARK";
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<T>(
    request: AIStructuredRequest<T>,
    context?: AIRequestContext
  ): Promise<AIStructuredResult<T>>;
}
```

> **Future Interface Methods (Deferred to Phase 1F+)**:
> - `generateStream()`: Context-grounded AI Tutor streaming (Phase 1F).
> - `generateEmbedding()`: Vector embeddings for hybrid semantic retrieval (Phase 1F).

### 2.1 Provider Implementations (Implemented in Phase 1E)
1. **`MockAIProvider` (`src/modules/ai/mock-provider.ts`)**:
   - Deterministic structural test provider returning JSON schema-compliant objects with simulated token counts and $0.00 spend.
   - Verifies mechanical pipeline invariants and schema compliance during tests and synthetic benchmark smoke.
   - **Quality Disclaimer**: Makes zero claim of factual accuracy or medical correctness; default output is not grounded in document text unless explicitly scripted for a test.
   - **Production Denial**: Unconditionally prohibited in production (`NODE_ENV === "production"`).
2. **`OpenAICompatibleProvider` (`src/modules/ai/openai-compatible-provider.ts`)**:
   - Production-ready adapter targeting OpenAI or OpenAI-compatible gateways (LiteLLM, Ollama, vLLM) with JSON Schema structured outputs.
   - Integrates `classifyAIError`: classifies transport failures (`ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`) and 5xx as retryable `AI_PROVIDER_UNAVAILABLE`.
3. **Provider Factory & Security Boundary (`src/modules/ai/provider-factory.ts`)**:
   - **Preflight Kill Switch**: `assertAIGenerationAvailable()` runs before enqueueing or processing, failing fast without database mutations when `AI_GENERATION_ENABLED=false`.
   - **Kill Switch on Injected Providers**: Product runtime enforces the kill switch even if an AI provider is injected when `NODE_ENV !== "test"`.
   - **Fail-Closed Endpoint Validation**: Enforces non-empty model, non-empty API key, explicit `baseURL` for all non-OpenAI providers, and requires HTTPS in production.

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
| **Study Pack Generation** | **AI-ASSISTED** | LLM with JSON Schema (2-call verification) | Generates structured summaries, objectives, concepts, high-yield points, glossary. (MCQs and flashcards deferred to later slices). |
| **Context-Grounded Tutor** | **AI-ASSISTED (FUTURE 1F)** | LLM with retrieved context chunks | Synthesizes answers with citations. |
| **Vector Embeddings** | **AI-ASSISTED (FUTURE 1F)** | Embedding model (Phase 1F) | Generates dense semantic vectors. |

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

