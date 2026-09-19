# ADR 004: Lean RAG Architecture with PostgreSQL FTS and pgvector

## Status
`ACCEPTED`

## Context
MedStudy Atlas provides a context-grounded AI Tutor that answers student questions citing exact pages and sections of their uploaded study materials. The retrieval system must support semantic similarity, precise keyword matching (e.g. specific drug names, medical eponyms like "Tetralogía de Fallot"), strict per-user tenant filtering, and low latency without incurring additional recurring infrastructure costs.

## Decision Drivers
- **Low TCO**: Avoid specialized vector database subscriptions (price and limits must be verified from official source before adoption).
- **Hybrid Retrieval Quality**: Medical terminology requires both semantic matching (concepts) and exact lexical matching (drug doses, eponyms).
- **Tenant Isolation**: Guarantee that a student can never retrieve another student's uploaded notes.

## Options Considered
1. **In-Database Hybrid RAG (PostgreSQL `pgvector` + `tsvector` FTS + RRF)**:
   - *Pros*: Zero additional infrastructure; `pgvector` HNSW indexes provide fast cosine similarity; native Spanish full-text search (`tsvector` + GIN) catches exact medical terms; Reciprocal Rank Fusion (RRF) combines ranks cleanly; native `WHERE user_id = auth.uid()` guarantees tenant security.
   - *Cons*: Extremely large vector datasets (>10M vectors) may require dedicated index tuning.
2. **Dedicated Vector Database (Pinecone / Qdrant / Weaviate)**:
   - *Pros*: Dedicated vector infrastructure, managed scaling.
   - *Cons*: Additional monthly subscription fee, extra network latency, complex synchronization and cross-database authorization checks, increased attack surface.
3. **Pure Lexical Search (Postgres FTS only)**:
   - *Pros*: Simplest implementation.
   - *Cons*: Cannot handle semantic synonyms or conceptual queries where phrasing differs from the slide text.

## Decision
**ADOPT Option 1**: Implement **Lean RAG directly in PostgreSQL**:
- Use `pgvector` with HNSW cosine distance indexing (`vector_cosine_ops`) on 1536-dimension embeddings.
- Use PostgreSQL full-text search (`tsvector` generated column, Spanish dictionary, GIN index) for lexical matching.
- Combine lexical and semantic results via **Reciprocal Rank Fusion (RRF)** in a single SQL query.
- Enforce strict tenant isolation: `document_chunks` does not hold `user_id` directly; isolation is enforced by joining `documents d ON d.id = c.document_id WHERE d.user_id = auth.uid()` and parent table RLS.
- Note that `VECTOR(1536)` is an initial schema placeholder; specific embedding model and dimension are formally selected in Slice 1D.
- Reject dedicated vector databases for the MVP.

## Consequences
### Positive
- $0 additional monthly infrastructure cost.
- Instant consistency: new chunks are immediately searchable upon database insert.
- Bulletproof tenant isolation: parent table RLS and explicit document joins ensure no cross-student leakage.
- High retrieval precision by combining keyword matches with semantic vectors.

### Negative / Trade-offs
- HNSW index build times and memory usage must be monitored as chunk volume grows.
- *Mitigation*: Limit chunk counts per document (initial configurable assumption: max 100 pages per doc, 400–800 tokens per chunk) and use compact vector footprints.

## Reversibility & Migration Path
If vector scale exceeds PostgreSQL capacity in Phase 3+, the vector retrieval query in `TutorModule` can be routed to an external vector database while retaining relational chunk metadata in PostgreSQL.

## Date
2026-09-19
