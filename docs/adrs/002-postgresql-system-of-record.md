# ADR 002: PostgreSQL as Primary System of Record and Concept Graph

## Status
`ACCEPTED`

## Context
MedStudy Atlas requires persistent storage for relational entities (users, courses, documents, questions), vector embeddings for RAG retrieval, full-text search for lexical querying, and a medical knowledge graph representing concept relationships (diseases, symptoms, treatments). We must determine whether to introduce a dedicated graph database (e.g. Neo4j) or model the knowledge graph within our primary database.

## Decision Drivers
- **Low TCO & Operating Costs**: Protect unit economics at ~S/ 10/month (~$2.70 USD/mo).
- **Operational Simplicity**: Avoid managing multiple database instances, dual-write synchronization, and specialized query languages (Cypher).
- **Data Integrity & Consistency**: Relational foreign keys and transactional consistency across concepts, questions, and flashcards.

## Options Considered
1. **PostgreSQL (Supabase) for Everything (Relational + Graph + Vector + FTS)**:
   - *Pros*: Single system of record; adjacency tables (`concepts`, `concept_relations`) easily model DAG and multi-relational graphs; recursive CTEs (`WITH RECURSIVE`) provide fast multi-hop traversal for clinical concept hierarchies; `pgvector` handles embeddings; built-in Row Level Security (RLS).
   - *Cons*: Graph traversal beyond 4-5 hops in very large graphs (>1M nodes) is less optimized than native graph storage engines.
2. **PostgreSQL + Dedicated Graph Database (Neo4j)**:
   - *Pros*: Native graph engine, Cypher query language, optimized for deep arbitrary-depth graph traversals.
   - *Cons*: Additional expensive cloud service (managed graph database subscriptions; price must be verified from official source before adoption), dual-write synchronization bugs, severe operational overhead for a small team, violates low-TCO principles.

## Decision
**ADOPT Option 1**: Use PostgreSQL (hosted on Supabase) as the **exclusive primary system of record**, modeling the initial Medical Knowledge Graph via relational tables (`concepts`, `concept_relations`) and recursive CTEs.
- Reject Neo4j for the MVP.
- Defer dedicated graph databases until empirical performance bottlenecks or complex multi-hop reasoning requirements emerge.

## Consequences
### Positive
- $0 additional database infrastructure cost.
- ACID transactions across user progress, questions, and concept mastery.
- Native foreign key constraints ensure zero orphaned concept relationships.
- Supabase Row Level Security (RLS) protects all data natively.

### Negative / Trade-offs
- Writing complex recursive CTEs requires disciplined SQL query design.
- *Mitigation*: Concept queries are encapsulated inside the `KnowledgeModule` with prepared views and caching.

## Reversibility & Migration Path
If deep graph traversal requires Neo4j post-PMF, the `concepts` and `concept_relations` tables can be synced to Neo4j via an asynchronous change data capture (CDC) pipeline without altering frontend or domain interfaces.

## Date
2026-09-19
