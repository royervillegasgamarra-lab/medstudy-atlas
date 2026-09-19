# MedStudy Atlas — Project Charter

## 1. Executive Summary & Mission
MedStudy Atlas is a commercial, adaptive medical-learning operating system designed to elevate medical education through evidence-based cognitive learning science, clinical knowledge modeling, and context-aware AI.

Our mission is to empower medical students to master high-volume, complex medical curriculums efficiently, retain foundational clinical knowledge long-term, and excel in rigorous medical assessments.

## 2. Target Audience & Geography
- **Primary Audience**: Medical students enrolled in undergraduate and graduate medical education programs.
- **Initial Target Geography**: Peru and broader Latin America (LATAM).
- **Contextual Constraints**: Varied internet bandwidth, diverse university curricula, localized medical terminology, and cost sensitivity across student demographics.

## 3. Commercial Nature & Pricing Hypothesis
- **Business Model**: Proprietary, commercial Software-as-a-Service (SaaS).
- **Pricing Hypothesis**: Approximately **S/ 10 / month** (~$2.70 USD/month) for the initial individual tier, subject to empirical willingness-to-pay and unit-economic validation.
- **Unit Economic Mandate**: The product must maintain an ultra-low operational cost per active student (frugal AI token consumption, aggressive caching, static asset offloading, minimal server idle compute) to remain viable at this price point.

## 4. Core Product Thesis
MedStudy Atlas is not merely:
- A generic "chat with your PDF" wrapper.
- A conventional Learning Management System (LMS).
- A basic Anki/flashcard clone.
- A static question bank (Qbank).
- A static 3D anatomy viewer.

**The Core Thesis**: MedStudy Atlas unifies syllabus-grounded medical knowledge with individual student memory states into an **Adaptive Medical-Learning Operating System**. It connects syllabus topics, clinical cases, anatomical structures, pharmacological mechanisms, and cognitive retrieval schedules into a cohesive, personalized learning loop.

## 5. Future Strategic Pillars
*(Note: These represent architectural vision and long-term product direction, not immediate Phase 0 implementations).*

1. **Medical Knowledge Graph (MKG)**: High-precision semantic graph organizing diseases, symptoms, anatomy, pharmacology, etiologies, and diagnostic criteria.
2. **Learner Model**: Dynamic cognitive state tracking measuring topic mastery, memory stability, retrieval latency, and metacognitive confidence calibration.
3. **Adaptive Study Engine**: Evidence-based scheduling algorithms combining spaced repetition, interleaving, and targeted active recall sessions.
4. **Document Study Engine**: High-fidelity ingestion of lecture slides, syllabi, and study guides with precise provenance anchoring.
5. **Content Quality & Provenance QA**: Automated and expert-in-the-loop validation pipelines ensuring every generated clinical explanation or quiz item cites authoritative sources.
6. **Multimodal Medical Learning**: Integrated medical imagery, anatomical schematics, ECGs, and clinical vignettes.
7. **Provenance-Aware AI**: Context-grounded retrieval architectures where AI tutors cite exact slides, pages, or medical consensus guidelines without hallucination.

## 6. Non-Clinical Educational Positioning
- **Purely Educational**: MedStudy Atlas is strictly an educational study companion for students.
- **No Clinical Decision Support**: Under no circumstances should MedStudy Atlas be marketed, designed, or utilized as a clinical diagnostic tool, point-of-care reference, or treatment decision support system.
- **Explicit Disclaimers**: All system outputs must be accompanied by explicit notices that content is for educational exam preparation and academic review only.

## 7. Product Principles
- **Revenue / Time-to-Market**: Before Product-Market Fit, prefer the simplest reversible solution that gets valuable functionality to paying users quickly. Avoid enterprise architecture for hypothetical scale. Quality, security, privacy, medical provenance, and data integrity remain non-negotiable.
- **OSS / GitHub-First Engineering**: Prioritize existing stack capabilities, mature permissive open-source solutions, and simple deterministic in-house implementations before introducing paid APIs or custom infrastructure. Evaluate Total Cost of Ownership (TCO).
- **Educational Efficacy Over Novelty**: Prefer proven cognitive techniques over flashy AI gimmicks.
- **Strict Content Provenance**: Every medical fact, question, and card must trace back to a verifiable source.
- **Frugal Architecture**: Keep infrastructure costs negligible per user.
- **Privacy & Student Data Protection**: Student progress data is confidential; no patient health information (PHI) is ever permitted.
- **Maintainability & Testability**: High automated test coverage, strict types, clean modular boundaries.
- **Justified Scalability**: Scale architecture only when empirical traffic and user load demand it.
