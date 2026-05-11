# MLE Engineering Log — SplitMate

**Owner:** Sruthi (ML Engineering Lead)
**Scope:** OCR pipeline, item classification, confidence scoring, longitudinal intelligence, spending analytics
**Roadmap reference:** [PLAN.md](PLAN.md)

---

## Where to Start — MVP Priorities

Work in this order. Nothing in V1 or V2 is worth touching until these are solid.

### 1. OCR Pipeline — Photo → Bill JSON Draft
**Branch:** `data_schema` (off `dev`)

The entire MLE value proposition starts here. Goal: take a photo or screenshot of a receipt and produce a confidence-scored bill JSON draft that maps to the agreed schema.

Steps:
- Evaluate Ollama models for receipt OCR: **phi-3-vision**, **llava**, **moondream** — test on real India and US receipts across all 4 MVP bill types
- Build country-aware post-processing: India (CGST/SGST detection, ₹ symbol, GST-inclusive MRP flag) vs US (pre-tax item prices, additive sales tax)
- Output schema: bill JSON with `confidence_scores` per field and `flagged_fields` array
- Confidence threshold: fields below threshold go into `flagged_fields` — surfaced to user for correction. High-confidence fields pre-filled silently.
- A parse failure outputs an empty draft with all fields flagged — never a crash, always manual entry fallback

**Blocker to resolve first:** SWE needs to add `parse_metadata JSONB` column to `receipt_assets` table — this is where confidence scores land. Flag this before writing pipeline output code.

### 2. Item Classifier — Line Type Detection
**Depends on:** OCR pipeline producing raw line text

For each line on a parsed receipt, classify it as:
`item | tax_line | fee_line | discount | tip | total | noise`

Then for items: `food | alcohol | non_taxable | other`

This classification drives which allocation rule applies. An alcohol line goes to alcohol claimants only. A tax line feeds the fee rule engine with the correct applicability scope.

### 3. Country-Aware Field Extraction
**Depends on:** Item classifier

- India: detect CGST + SGST as a pair → aggregate as single GST line. Flag MRP-inclusive prices. Detect service charge vs tip.
- US: detect state sales tax line. Detect tip line. Item prices are pre-tax — no adjustment needed.
- Both: extract merchant name, date, total, subtotal, individual line items with quantities and unit prices.

### 4. Spending Personality Algorithm (V1 — build data pipeline now)
Even though Spending Personality ships in V1, the data it needs comes from MVP bills. Design the aggregation queries now so V1 is just a read on top of existing data — not a backfill.

Metrics to track per user per group from day one:
- Ratio of actual share paid vs computed fair share (fairness delta)
- Category breakdown of claimed items
- Days-to-settle per expense

---

---

## Responsibilities

- Receipt parsing pipeline (OCR → structured bill JSON)
- Item and fee classification models
- Confidence scoring and uncertainty surfacing for human-in-the-loop correction
- Country-aware field detection (₹ vs $, GST line vs sales tax line)
- Layer 2 intelligence: spending trends, fairness tracking, anomaly detection, spending personality

---

## Design Decisions

### 2026-05-10 — OCR is a draft, not a source of truth

**Decision:** OCR output is always treated as a draft. Every parsed field carries a confidence score. Only low-confidence fields are surfaced to the user for correction — high-confidence fields are pre-filled silently.

**Why:** Forcing users to review every field creates friction and defeats the purpose of OCR. Forcing zero review creates trust issues when the app gets something wrong. Confidence-gated correction is the right middle ground — the app earns trust over time by being right quietly and asking only when uncertain.

**Implication:** The OCR pipeline must output confidence per field, not just values. The UI contract with SWE requires a confidence threshold parameter to determine what gets flagged.

---

### 2026-05-10 — Country-aware parsing from the start

**Decision:** OCR pipeline handles India and USA bill formats as distinct modes, selected at group-creation time.

**Why:** Indian bills show GST breakdowns inline (CGST + SGST), prices are often GST-inclusive, and the ₹ symbol has OCR ambiguity. US bills show pre-tax item prices and add tax at the bottom. Treating these as one generic format produces incorrect field mappings. Country mode must be set before parsing begins.

**Implication:** Two parsing configurations — one per market. Shared base pipeline, country-specific post-processing and field extraction logic.

---

### 2026-05-10 — Input modalities all funnel to the same schema

**Decision:** Photo, screenshot, PDF, and manual entry all produce the same bill JSON schema. OCR and manual are different entry paths to the same data model — not different data models.

**Why:** Downstream systems (split engine, explainability view, settlement) should never need to know how a bill was entered. Coupling them to input modality would create parallel code paths and inconsistency.

---

## Longitudinal Intelligence — Design Notes

### Fairness tracking
Track per-user, per-group over time: are they consistently paying more or less than their computed fair share? Surface this as a fairness score (internal metric, optionally shareable). Flag persistent imbalance.

### Spending personality
Derived from category breakdown and payment behavior over minimum 5 bills. Labels: Splurger / Even-Steven / The Optimizer / The Settler. Shown as a subtle profile tag, never pushed aggressively.

### Anomaly detection
Flag when a bill has unusually high fees relative to order value (e.g. delivery fee > 40% of subtotal). Educates users on where their money goes without being preachy.

### Settlement behavior
Track days-to-settle per group and per person. Surfaces as a group trust signal. Used in the settlement streak gamification mechanic.

---

## Open Questions

- [ ] PaddleOCR vs Tesseract: evaluate on real Indian and US receipts before committing
- [ ] Minimum bill history required before Layer 2 insights are shown (avoid misleading data)
- [ ] How to handle bills with no itemization (flat totals only) in the classification pipeline
- [ ] PDF parsing: native PDF text extraction first, OCR fallback for scanned PDFs

---

## Release Log

| Date | Update |
|---|---|
| 2026-05-10 | MLE scope defined, design decisions logged for OCR pipeline approach |
