# ADR 006: Thin AI Provider Abstraction and Hard Cost Controls

## Status
`ACCEPTED`

## Context
MedStudy Atlas leverages Large Language Models (LLMs) for Study Pack generation (summaries, MCQs, flashcards) and context-grounded AI Tutoring. With a commercial price target of ~S/ 10/month (~$2.70 USD/mo), uncontrolled AI token consumption poses an existential risk to business viability. Furthermore, coupling business logic directly to a specific LLM vendor SDK creates high technical debt and vendor lock-in.

## Decision Drivers
- **Unit Economic Viability**: Keep monthly AI costs per active student $\le \$0.80 \text{ USD}$ to preserve $\ge 70\%$ gross margin.
- **Simplicity & Maintainability**: Avoid complex multi-agent frameworks (LangChain, LlamaIndex) that add layers of opacity and latency.
- **Provider Agility**: Ability to swap model providers or utilize cheaper/faster models as the AI market evolves.

## Options Considered
1. **Thin Internal `AIProvider` Abstraction + Single Provider Start + Hard Quotas**:
   - *Pros*: Single TypeScript interface; zero third-party agent framework bloat; start with one cost-effective provider (e.g. OpenAI `gpt-4o-mini` / Google `gemini-1.5-flash`); hard token limits and database quotas guarantee cost containment; centralized telemetry logging in `ai_usages`.
   - *Cons*: Cannot automatically fallback between multiple providers in mid-flight without minor manual configuration.
2. **Multi-Provider AI Gateway SaaS (Portkey / Helicone / OpenRouter)**:
   - *Pros*: Built-in routing, fallbacks, and caching.
   - *Cons*: Introduces another third-party subscription, external latency hop, extra failure point, potential data privacy concerns.
3. **Heavy Agent Framework (LangChain / LlamaIndex)**:
   - *Pros*: Abstractions for hundreds of tools, vector stores, and prompt chains.
   - *Cons*: Excessive dependency footprint, rapid breaking changes, difficult debugging, high memory overhead, anti-pattern for our lean architecture.

## Decision
**ADOPT Option 1**: Implement a **Thin Internal `AIProvider` Abstraction** with strict cost controls:
- **Single Provider Start**: Launch with ONE proven, cost-effective provider.
- **Thin Interface**: Encapsulate `generateStructured`, `generateStream`, and `generateEmbedding` in `src/modules/ai`.
- **Hard Token Limits**: Enforce maximum input (1,500 tokens) and output (500 tokens) on Tutor queries; max 8,000 input on Study Pack generation.
- **Database Quotas**: Free tier capped at 10 Tutor queries/day; PRO capped at 50 queries/day.
- **Circuit Breaker**: Hard monthly spend cap of $1.50 USD per user in `ai_usages` table.
- **Deterministic-First Policy**: Prohibit LLM usage for tasks solvable deterministically (FSRS, ranking, classification, deduplication).

## Consequences
### Positive
- Predictable, capped AI expenditures protecting gross margin.
- Zero framework bloat; clean, readable TypeScript codebase.
- Full telemetry on every prompt and completion recorded in PostgreSQL.
- Trivial model swapping by updating environment variables.

### Negative / Trade-offs
- Prompt engineering and JSON Schema validation must be maintained in-house.
- *Mitigation*: Use native provider structured outputs (`response_format: { type: 'json_object' }` or JSON schema).

## Reversibility & Migration Path
Because all domain modules call `AIProvider`, swapping the underlying provider or introducing an external gateway (like Helicone) in Phase 2 requires changing only one file in `src/modules/ai`.

## Date
2026-09-19
