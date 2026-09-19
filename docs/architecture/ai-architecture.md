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
  feature: 'STUDY_PACK_GEN' | 'TUTOR_CHAT' | 'QUESTION_GEN' | 'SUMMARY' | 'EMBEDDING';
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
  userId: string;
  documentId?: string;
}

export interface AIProvider {
  generateStructured<T>(prompt: string, schema: Record<string, unknown>, options: AICompletionOptions): Promise<{ data: T; telemetry: AITelemetry }>;
  generateStream(messages: Array<{ role: string; content: string }>, options: AICompletionOptions): AsyncIterable<{ chunk: string; telemetry?: AITelemetry }>;
  generateEmbedding(text: string, options: { userId: string }): Promise<{ embedding: number[]; telemetry: AITelemetry }>;
}
```

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
| **Study Pack Generation** | **AI-ASSISTED** | LLM with JSON Schema | Generates structured summaries, MCQs, cards. |
| **Context-Grounded Tutor** | **AI-ASSISTED** | LLM with retrieved context chunks | Synthesizes answers with citations. |
| **Vector Embeddings** | **AI-ASSISTED** | Embedding model | Generates dense semantic vectors. |

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

### Hard Cost Controls Matrix (Configurable Safeguards)
1. **Hard Token Ceilings** (`INITIAL CONFIGURABLE ASSUMPTION`):
   - Tutor Query: Max 1,500 input context tokens + max 500 completion tokens.
   - Study Pack: Max 8,000 input tokens + max 2,500 output tokens (chunked and cached).
2. **Feature Quotas (Enforced in Database)** (`INITIAL CONFIGURABLE ASSUMPTION`):
   - Free Tier: Max 5 document uploads/month, max 10 Tutor messages/day, 1 Study Pack/document.
   - PRO Tier: Max 50 document uploads/month, max 50 Tutor messages/day.
3. **Generation Caching**:
   - A Study Pack is generated **once** upon document upload and stored in PostgreSQL (`study_packs`). It is never regenerated on page views.
4. **Prompt Caching**:
   - Leverage provider prompt caching (e.g., cached tokens) for static medical system prompts.
5. **Circuit Breaker** (`INITIAL CONFIGURABLE ASSUMPTION`):
   - If a user's monthly AI consumption exceeds $1.50 USD in telemetry tracking (`ai_usages`), AI requests are throttled with a friendly rate-limit notice until billing cycle renewal.

**Conclusion**: Profitability is protected by strictly decoupling user interactions from uncontrolled AI calls: heavy inference is cached, repetitive queries use deterministic algorithms, and variable AI expenditure is bounded by database-enforced quotas.
