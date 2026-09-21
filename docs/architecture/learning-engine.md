# MedStudy Atlas — Learning Engine: Spaced Repetition, Learner Model & Today Engine

## 1. Overview & Cognitive Science Foundation
MedStudy Atlas is built upon empirically verified principles of cognitive learning science:
1. **Active Retrieval Practice**: Testing knowledge strengthens synaptic memory consolidation far more than passive re-reading.
2. **Spaced Repetition (FSRS)**: Reviewing material at mathematically optimized expanding intervals to prevent memory decay.
3. **Interleaving**: Alternating related medical concepts (e.g., distinguishing Aortic Stenosis from Mitral Regurgitation) to foster deep clinical differentiation.
4. **Metacognitive Calibration**: Aligning the student's perceived confidence with actual objective accuracy to eliminate the "illusion of competence".

---

## 2. Spaced Repetition Architecture: FSRS Algorithm via `open-spaced-repetition/ts-fsrs`

### Separation of Content from Scheduling State
Flashcard content is immutable or versioned independently of student progress:
- **`Flashcard`**: Represents the medical knowledge item (`front`, `back`, `explanation`, `provenance`).
- **`UserFlashcardState`**: Belongs strictly to the individual student, storing FSRS scheduling parameters.

```mermaid
flowchart LR
    Card["Flashcard (Shared / StudyPack Content)"] -->|1:N| UserState["UserFlashcardState (Student Progress)"]
    UserState -->|Records| ReviewLog["FlashcardReview (Historical Logs)"]
    
    subgraph FSRSEngine["ts-fsrs Mathematical Engine"]
        Rating["Student Rating: 1=Again, 2=Hard, 3=Good, 4=Easy"] --> Compute["Compute New Stability (S) & Difficulty (D)"]
        Compute --> NextInterval["Calculate Next Due Date (due_at)"]
    end
    
    ReviewLog --> FSRSEngine
    FSRSEngine --> UserState
```

### FSRS Integration & Versioning Clarity
We adopt `open-spaced-repetition/ts-fsrs` (MIT licensed, pure TypeScript) to implement the Free Spaced Repetition Scheduler (FSRS) algorithm:
- **Algorithm vs. Package Distinction**: A clear distinction is maintained between the theoretical FSRS algorithm generations (e.g., FSRS-4, FSRS-4.5, FSRS-5) and the semantic versions of the `ts-fsrs` npm package. The exact npm package version will be formally pinned in Phase 1H (Flashcards & FSRS).
- **Stability ($S$)**: The time in days required for memory retrievability to decay from 100% to 90%.
- **Difficulty ($D$)**: Inherent complexity of the card on a 1–10 scale.
- **State ($State$)**: `0=New`, `1=Learning`, `2=Review`, `3=Relearning`.
- **Deterministic Math**: Zero network requests, zero database queries during computation; the algorithm runs synchronously in the application runtime.

---

## 3. The Learner Model: `LearnerConceptState`

Rather than implementing opaque machine learning or complex psychometric models (IRT, BKT, CAT) during the MVP, MedStudy Atlas uses a **transparent, deterministic Learner Model**.

### Entity Schema & Signals
For every medical concept (e.g., *Cetoacidosis Diabética*), the student has a `LearnerConceptState` record:

| Signal | Type | Range | Description |
| :--- | :--- | :--- | :--- |
| `mastery` | `NUMERIC(3,2)` | `0.00` – `1.00` | Current estimated competence on the concept. |
| `confidence` | `NUMERIC(3,2)` | `0.00` – `1.00` | Student's self-assessed certainty during attempts. |
| `forgetting_risk` | `NUMERIC(3,2)` | `0.00` – `1.00` | Estimated probability that memory has decayed below recall threshold. |
| `attempt_count` | `INT` | $\ge 0$ | Total questions and cards answered for this concept. |
| `correct_count` | `INT` | $\ge 0$ | Successful attempts. |
| `incorrect_count`| `INT` | $\ge 0$ | Unsuccessful attempts. |
| `error_recurrence`| `INT` | $\ge 0$ | Number of times errors repeated after feedback. |
| `last_attempt_at`| `TIMESTAMPTZ` | Timestamp | Date/time of most recent interaction. |
| `next_review_at` | `TIMESTAMPTZ` | Timestamp | Scheduled review target. |

### Deterministic Mastery Calculation
Mastery is computed deterministically after each question attempt or flashcard session:

$$\text{Accuracy} = \frac{\text{correct\_count}}{\text{attempt\_count}}$$

$$\text{RecencyWeight} = \exp\left(-\frac{\Delta t_{\text{days}}}{30}\right)$$

$$\text{Mastery} = 0.6 \cdot \text{Accuracy} + 0.25 \cdot (1 - \text{forgetting\_risk}) + 0.15 \cdot \text{RecencyWeight} - (0.05 \cdot \text{error\_recurrence})$$

*Clamped to $[0.00, 1.00]$.*

### Evolution Path (Post-PMF)
This deterministic formula can be swapped later for Bayesian Knowledge Tracing (BKT) or Item Response Theory (IRT) without altering the database schema, as the historical logs in `question_attempts` and `flashcard_reviews` preserve the underlying data.

---

## 4. The "Today" Engine: Daily Prioritized Learning Plan

The "Today" plan tells the student exactly what to study each day in a focused session (30–60 minutes, `INITIAL CONFIGURABLE ASSUMPTION`), removing decision fatigue.

### Prioritization Formula
Each concept $c$ in the student's curriculum is assigned a **Priority Score**:

$$\text{Priority}(c) = w_1 \cdot \text{ExamUrgency} + w_2 \cdot \text{ForgettingRisk} + w_3 \cdot \text{KnowledgeGap} + w_4 \cdot \text{ErrorRecurrence} + w_5 \cdot \text{CurriculumWeight}$$

### Initial Deterministic Weights (MVP Baseline — Heuristic)
- $w_1 = 0.30$ (**Exam Urgency**): Proximity of the target exam date (e.g., ENAM exam in 60 days vs 300 days).
- $w_2 = 0.25$ (**Forgetting Risk**): Computed directly from FSRS retrievability decay.
- $w_3 = 0.20$ (**Knowledge Gap**): $1.00 - \text{Mastery}$.
- $w_4 = 0.15$ (**Error Recurrence**): Concepts actively logged in the Error Notebook with repeat mistakes.
- $w_5 = 0.10$ (**Curriculum Weight**): High-yield topics in official exam blueprints (e.g., Cardiology carries higher ENAM weight than Dermatology).

*Note*: These weights are initial configurable assumptions and will be calibrated empirically using student performance data post-launch.

---

## 5. Study Pack Architecture & Lifecycle

### 5.1 IMPLEMENTED Phase 1E: Normalized Study Pack Model & Lifecycle
A **Study Pack** is a pre-generated, cached learning unit produced deterministically from an uploaded document's chunks. It prevents redundant, expensive AI inference.

```mermaid
stateDiagram-v2
    [*] --> PENDING: Document Processed
    PENDING --> GENERATING: Worker claims job (claim_token, lease)
    GENERATING --> READY: Generation + Verification succeed (persisted)
    GENERATING --> FAILED_RETRYABLE: Transient error (attempts < max_retries)
    FAILED_RETRYABLE --> GENERATING: Worker retries after backoff
    GENERATING --> FAILED_FINAL: Terminal error / empty pack / retries exhausted
    READY --> [*]
```

#### Implemented Status Lifecycle (`study_packs.status`)
The database-enforced lifecycle for study packs uses `StudyPackStatus`:
- **`PENDING`**: Initial state upon enqueueing.
- **`GENERATING`**: Claimed by a worker with an active lease and claim token.
- **`READY`**: Candidate generation and automated verifier succeeded; verified items are persisted.
- **`FAILED_RETRYABLE`**: Transient failure (e.g. rate limit or network timeout) with retry attempts remaining.
- **`FAILED_FINAL`**: Terminal failure (e.g. unretryable error, zero supported items / empty pack, or exhausted retries).

#### Implemented Normalized Item Types (`study_pack_items.item_type`)
Phase 1E implements five normalized item types:
1. `SUMMARY`: Clinical synthesis and high-yield overview.
2. `LEARNING_OBJECTIVE`: Competency-based medical learning outcome.
3. `KEY_CONCEPT`: Core pathophysiological or clinical concept.
4. `HIGH_YIELD_POINT`: High-yield clinical pearl or board-relevant takeaway.
5. `KEY_TERM`: Key medical vocabulary with definition.

#### Implemented Automated Verification (Two-Call Pipeline)
Rather than a single status column, verification is performed by a dedicated second AI call:
- **Binary Decision**: Each candidate item is evaluated strictly as `SUPPORTED` or `UNSUPPORTED` against retrieved source evidence chunks.
- **Persistence Invariant**: Only items verified as `SUPPORTED` with valid chunk citations are persisted to `study_pack_items`.
- **Empty Pack Invariant**: If all candidate items are judged `UNSUPPORTED`, the pack transitions to `FAILED_FINAL` with error code `EMPTY_PACK`.
- **Display-Only Citation Invariant**: In UI presentation, items render display-only page citation badges (`Pag. X`) linking the item to its underlying document evidence.

---

### 5.2 FUTURE Learning Engine (Target Slices 1F+)
The downstream interactive learning modalities build upon the verified Phase 1E foundation:
- **Questions & MCQs (Phase 1G)**: 5-option clinical vignette MCQs with plausible distractors, rationales, and automated QA gates.
- **Flashcards & FSRS Spaced Repetition (Phase 1H)**: Atomic front/back cards scheduled via the FSRS algorithm (`open-spaced-repetition/ts-fsrs`) using isolated `user_flashcard_states`.
- **Error Notebook (Phase 1I)**: Automated capture of student mistakes, misconception tagging (`KNOWLEDGE_GAP`, `MISREAD_QUESTION`, `CONFUSED_CONCEPTS`, `REASONING_ERROR`), and targeted review queues.
- **Today Engine (Phase 1J)**: Daily prioritized learning plan synthesizing forgetting risk, exam proximity, and knowledge gaps.

---

## 6. Question Generation & Minimum Viable QA (Future Phase 1G Target)

AI-generated medical questions must pass automated validation checks before being presented to students:

| QA Gate | Validation Rule | Action on Failure |
| :--- | :--- | :--- |
| `structureValid` | Exactly 1 correct option, 4 plausible distractors, non-empty vignette. | Reject output; re-prompt with JSON schema. |
| `evidenceSupported` | Correct answer must cite an exact chunk quote in the document. | Flag question; exclude from Question Bank. |
| `distractorsValid` | Distractors must represent real clinical misconceptions, not joke answers. | Filter out low-plausibility distractors. |
| `medicalSafety` | Check against banned clinical recommendations (e.g., dangerous drug dosages). | Immediate discard; alert in QA log. |
| `duplicateRisk` | Jaccard / embedding similarity with existing questions < 0.85. | Discard duplicate question. |

---

## 7. The Error Notebook (Future Phase 1I Target)
When a student answers a question incorrectly, an `ErrorRecord` is automatically created:
1. **Misconception Tagging**: Student or AI tags the failure:
   - `KNOWLEDGE_GAP`: Did not know the medical fact.
   - `MISREAD_QUESTION`: Skipped "EXCEPT", "MOST LIKELY", or laboratory unit.
   - `CONFUSED_CONCEPTS`: Confused two related diseases (e.g., Crohn vs Ulcerative Colitis).
   - `REASONING_ERROR`: Knew facts but applied incorrect diagnostic logic.
2. **Reinforcement Loop**: Unresolved errors are injected with high priority into the Today engine until the student passes 2 consecutive retrieval checks on that concept.
