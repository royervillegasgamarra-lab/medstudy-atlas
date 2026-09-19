# ADR 007: Database-Backed Background Processing for MVP

## Status
`ACCEPTED`

## Context
MedStudy Atlas requires asynchronous execution for time-consuming operations: document page classification, text extraction, selective OCR, chunk embedding generation, and Study Pack assembly. Running these synchronously in HTTP request handlers would cause browser timeouts and poor user experience. We must choose a background processing mechanism that provides retries, idempotency, and status tracking without unnecessary infrastructure overhead.

## Decision Drivers
- **Simplicity & Zero Extra Infrastructure**: Avoid managing Redis clusters or additional commercial SaaS platforms.
- **Reliability & Idempotency**: Jobs must survive worker restarts, support automatic retries (max 3), and prevent duplicate processing.
- **Low Cost**: $0 additional recurring cost for the MVP.

## Options Considered
1. **PostgreSQL-Backed Job Queue Table (`jobs` / `document_jobs`)**:
   - *Pros*: Leverages existing PostgreSQL database; transactional job creation (document insert + job insert in one transaction); supports `FOR UPDATE SKIP LOCKED` for concurrent workers; simple polling or Supabase realtime notification; $0 extra infrastructure cost.
   - *Cons*: High-throughput message processing (>10,000 jobs/sec) can increase database write load (not an issue for our MVP user volume).
2. **Dedicated Background Framework (`triggerdotdev/trigger.dev` or Inngest)**:
   - *Pros*: Sophisticated task dashboards, automatic checkpointing, serverless execution.
   - *Cons*: Requires separate cloud subscription or complex self-hosted orchestration container; premature complexity for an initial MVP.
3. **Redis + BullMQ**:
   - *Pros*: Fast in-memory queue.
   - *Cons*: Requires running and maintaining a Redis instance (Upstash / Redis Cloud), introduces dual-database consistency challenges.

## Decision
**ADOPT Option 1**: Use a **PostgreSQL-Backed Job Queue Table** for the MVP:
- Store asynchronous tasks in a database table with status tracking (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`).
- **Separation of Concerns**: PostgreSQL stores and coordinates jobs (`FOR UPDATE SKIP LOCKED`); a separate background worker executes them. The database does not execute OCR or processing.
- **Local Development**: Uses a local worker process running in the same repository (`pnpm worker:dev`).
- **Production Execution**: Production worker hosting will be formally selected before **Slice 1D** (Document Ingestion). Serverless or container execution is only acceptable if actual runtime, memory, timeout, and cost requirements fit (heavy OCR or parsing tasks may exceed typical serverless duration or memory limits).
- Workers claim tasks using standard PostgreSQL locking:
  ```sql
  UPDATE jobs 
  SET status = 'PROCESSING', locked_at = NOW(), attempts = attempts + 1
  WHERE id = (
    SELECT id FROM jobs 
    WHERE status = 'PENDING' AND (scheduled_at IS NULL OR scheduled_at <= NOW())
    ORDER BY created_at ASC 
    LIMIT 1 
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
  ```
- Defer Trigger.dev or BullMQ until background volume exceeds PostgreSQL queue capacity.

## Consequences
### Positive
- $0 additional infrastructure cost.
- Complete transactional consistency: a document record and its processing job are created in the exact same database transaction.
- Easy inspection and debugging via standard SQL queries.

### Negative / Trade-offs
- Polling adds minor database query load.
- *Mitigation*: Use adaptive backoff polling (e.g. 1s when active, 5s when idle) or Supabase table change notifications.

## Reversibility & Migration Path
Job payloads are serialized as JSON. Migrating to Trigger.dev or BullMQ in Phase 2 involves swapping the queue enqueue/dequeue adapter without changing job handler logic.

## Date
2026-09-19
