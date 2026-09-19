# What Is Not Being Built Yet

To maintain focus, velocity, and architectural simplicity, the following features and technologies are **explicitly deferred**.

> [!NOTE]
> Deferment is an intentional engineering decision to sequence work properly. Deferment does **not** mean permanent rejection. Each capability will be evaluated when foundational requirements are met.

---

## 1. Production Infrastructure & Operations
- **Production Authentication**: No live auth providers, social logins, or session infrastructure in Phase 0.
- **Production Database**: No live Supabase or PostgreSQL instances will be provisioned until architecture and local baselines are complete.
- **Paid AI Providers**: No OpenAI, Anthropic, or paid Gemini API keys will be provisioned or billed.
- **Payment & Billing Gateways**: No Stripe, Mercado Pago, or subscription logic until a working product prototype exists.
- **Hospital & EMR Integrations**: No FHIR, HL7, or electronic medical record integrations.

## 2. Advanced AI & Learning Models
- **Item Response Theory (IRT)**: Complex psychometric IRT models are deferred in favor of simpler, validated scoring algorithms.
- **Bayesian Knowledge Tracing (BKT)**: Probabilistic graphical models for knowledge state tracking are deferred.
- **Computerized Adaptive Testing (CAT)**: High-complexity adaptive testing engines are deferred until question banks reach critical volume.
- **Unbounded Multi-Agent Systems**: Complex autonomous multi-agent swarms will not be implemented.
- **Unverified "Learning Styles"**: Personalization based on debunked "learning styles" (visual, auditory, kinesthetic) will **never** be built.

## 3. High-Complexity Medical Visualizations
- **Full 3D Anatomy Engine**: Interactive 3D WebGL/WebGPU anatomical rendering is deferred. Initial versions will focus on high-yield 2D annotated diagrams and spatial schematics.
- **DICOM Imaging Viewer**: Full PACS/DICOM radiological image viewers (CT, MRI, X-ray) with multi-planar reconstruction are deferred.
- **Pathology Whole Slide Imaging (WSI)**: Gigapixel digital pathology slide viewers are deferred.

## 4. Social & Institutional Capabilities
- **Institutional Multi-Tenancy**: University portals, dean dashboards, and professor assignment tools are deferred; initial focus is single-student direct-to-consumer (D2C).
- **Social Networking**: Student chat rooms, forums, peer leaderboards, and study groups are deferred.
- **Native Mobile Apps**: Native iOS/Android apps (React Native, Flutter, Swift/Kotlin) are deferred. The product will be a mobile-responsive Progressive Web App (PWA) first.
