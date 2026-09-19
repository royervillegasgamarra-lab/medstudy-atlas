# ADR 005: Spaced Repetition Scheduling via ts-fsrs (FSRS Algorithm)

## Status
`ACCEPTED`

## Context
Flashcard retrieval practice is a cornerstone of the MedStudy Atlas learning loop. Traditional spaced repetition algorithms (such as SM-2, used in early Anki versions) rely on rigid heuristic intervals that poorly model memory retrievability and difficulty. The modern Free Spaced Repetition Scheduler (FSRS) algorithm provides superior retention modeling and interval optimization. We need a reliable, low-overhead implementation for our TypeScript stack.

## Decision Drivers
- **Learning Effectiveness**: Maximize long-term retention while minimizing redundant reviews for medical students.
- **Runtime Performance**: Spaced repetition calculations must execute synchronously in milliseconds without network or database latency.
- **Licensing & Dependencies**: Permissive open-source license with zero external runtime dependencies.

## Options Considered
1. **`open-spaced-repetition/ts-fsrs` (Canonical TypeScript FSRS Library)**:
   - *Pros*: MIT License; pure TypeScript; zero external dependencies; implements the modern FSRS algorithm mathematical model (stability, difficulty, retrievability); active community; battle-tested in modern flashcard tools. Distinction maintained between algorithm generations and npm package versions; exact package version pinned in Phase 1H.
   - *Cons*: Requires storing 5–6 numerical parameters per flashcard state (stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state).
2. **Classic SM-2 Algorithm (Custom In-House Implementation)**:
   - *Pros*: Very simple math (ease factor, interval, repetitions).
   - *Cons*: Inferior retention modeling; suffers from "ease factor hell" where difficult cards accumulate excessive reviews; obsolete compared to FSRS.
3. **External Spaced Repetition API**:
   - *Pros*: Fully managed.
   - *Cons*: Introduces network latency per review, monthly API costs, unnecessary vendor lock-in.

## Decision
**ADOPT Option 1**: Use **`open-spaced-repetition/ts-fsrs`** as the core spaced repetition scheduling engine:
- Store FSRS state in `user_flashcard_states` (`stability`, `difficulty`, `due_at`, `state`, etc.).
- Decouple flashcard content (`flashcards`) from individual student scheduling state (`user_flashcard_states`).
- Execute scheduling updates synchronously on the server when a student submits a card rating (1=Again, 2=Hard, 3=Good, 4=Easy).

## Consequences
### Positive
- State-of-the-art memory decay modeling tailored to medical students' high-volume recall demands.
- $0 operational cost; pure mathematical execution in Node.js.
- Clean separation of content from user scheduling state allows sharing and updating flashcard content without resetting student progress.

### Negative / Trade-offs
- Slight learning curve in understanding FSRS parameters ($S$, $D$, $R$) compared to simple intervals.
- *Mitigation*: The `LearningModule` encapsulates all FSRS logic, exposing simple high-level methods (`recordReview(userId, cardId, rating)`).

## Reversibility & Migration Path
Because individual review histories are preserved in `flashcard_reviews`, any future scheduling algorithm could recalculate card states from historical logs without data loss.

## Date
2026-09-19
