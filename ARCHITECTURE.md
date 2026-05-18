# Architecture — SplitMate

> How we think about building this system: data flow, security, tradeoffs, and what we deliberately chose not to do.

---

## System Overview

SplitMate is a local-first group expense app. The core data flow is:

```
Bill Input (OCR / Manual / Upload)
        ↓
  Bill JSON Schema  ←── country config (India / USA)
        ↓
  Fee Rule Engine   ←── bill type rules + user overrides
        ↓
  Split Engine      ←── item assignments + group members
        ↓
  Per-Person Output (explainability breakdown)
        ↓
  Settlement Optimizer (debt graph → minimal transactions)
        ↓
  Settlement View (traceable to source bills)
        ↓
  Longitudinal Store → Group Intelligence Layer (MLE)
```

Everything downstream of "Bill JSON Schema" is deterministic and rule-based. The money math is never a black box.

OCR uses **ML Kit on-device** (Google ML Kit, ~15MB, no network call) — raw text extraction happens locally and privately. Your parsing and classification logic converts that raw text into structured bill JSON. No image ever leaves the device.

---

## The Bill Data Model

The bill JSON schema is the single most critical artifact in the system. All other components — OCR output, split engine input, UI, explainability output — are built against this schema.

### Core Bill Schema

```json
{
  "bill_id": "uuid",
  "group_id": "uuid",
  "bill_type": "restaurant | grocery | delivery | accommodation | utility | subscription | custom",
  "country": "IN | US",
  "currency": "INR | USD",
  "created_by": "user_id",
  "created_at": "ISO8601",
  "input_source": "ocr | manual | upload",
  "merchant": {
    "name": "string",
    "state": "string (US only — for tax rate lookup)"
  },
  "items": [
    {
      "item_id": "uuid",
      "description": "string",
      "unit_price": 0,
      "quantity": 1,
      "subtotal": 0,
      "category": "food | alcohol | non_taxable | other",
      "assigned_to": ["user_id"],
      "split_type": "equal | exact | percentage | sole"
    }
  ],
  "charges": [
    {
      "charge_id": "uuid",
      "type": "delivery_fee | platform_fee | service_charge | tip | surge | bag_fee | other",
      "amount": 0,
      "allocation_rule": "proportional_order_value | proportional_subtotal | equal_per_person | flat_per_person | item_specific",
      "applies_to": "all | alcohol_only | custom_item_ids"
    }
  ],
  "taxes": [
    {
      "tax_id": "uuid",
      "type": "GST | CGST | SGST | IGST | sales_tax | alcohol_tax",
      "rate": 0.05,
      "amount": 0,
      "applies_to": "all | category:food | category:alcohol | item_ids",
      "inclusive": false
    }
  ],
  "total": 0,
  "split_rules": {
    "template_id": "uuid | null",
    "overrides": {}
  },
  "ocr_metadata": {
    "confidence_scores": {},
    "raw_text": "string",
    "flagged_fields": ["field_names"]
  }
}
```

### Per-Person Output Schema (split engine output)

```json
{
  "bill_id": "uuid",
  "splits": [
    {
      "user_id": "uuid",
      "total_owed": 0,
      "currency": "INR | USD",
      "breakdown": [
        {
          "type": "item | charge | tax",
          "description": "string",
          "amount": 0,
          "note": "string (e.g. '1/3 share', 'proportional to your ₹450 order')"
        }
      ]
    }
  ]
}
```

---

## Fee Rule Engine

Each charge type has a default allocation strategy. Users can override per bill.

| Charge Type | Default Rule | Rationale |
|---|---|---|
| Delivery fee | Proportional to order value | Bigger orders cost more to deliver |
| Platform fee | Equal per person | Fixed cost of using the platform |
| Service charge | Proportional to pre-tax subtotal | Service scales with how much you ordered |
| Tip | Proportional to pre-tax subtotal | Standard tipping convention |
| Alcohol tax | Alcohol buyers only | Only applicable to who ordered it |
| GST (India) | By applicable category, inclusive if MRP | Follows Indian tax law |
| Sales tax (US) | Proportional to taxable items, by state rate | Follows US state tax law |
| Surge / small order fee | Equal per person | Platform-level charge, not usage-based |
| Bag fee | Per person who received bags | Direct attribution |

---

## Settlement Optimizer

Debt graph simplification using a min-flow algorithm:
1. Compute net balance per person (what they paid minus what they owe)
2. Sort creditors (positive balance) and debtors (negative balance)
3. Greedily match largest debtor to largest creditor
4. Produces minimum number of transactions to settle all debts

**Settlement traceability:** each settlement transaction links back to the source bills that created the debt. Displayed as: "You owe Priya ₹640 — ₹340 from dinner on May 3, ₹300 from groceries on May 7."

---

## Country-Aware Tax Logic

### India
- GST rates: 0%, 5%, 12%, 18%, 28% by item category
- Restaurant food: 5% GST (dine-in), delivery attracts additional fee GST
- GST often split as CGST + SGST on bill — OCR detects and aggregates
- MRP prices are GST-inclusive — pipeline flags and adjusts accordingly
- Service charge: optional 10%, not a tax (user can mark as tip-equivalent)

### USA
- Sales tax: varies by state — stored per group (set at group creation)
- Alcohol tax: separate line in some states, bundled in others
- Tip: not a tax — modeled as a charge with proportional allocation
- No federal GST equivalent — tax is always additive, never inclusive

---

## Security Model

### Data at rest
- All bill and group data stored locally in SQLite (primary)
- Supabase sync is optional and user-initiated — not automatic
- No bill data leaves the device without explicit user action

### Authentication
- Supabase Auth for identity (if sync enabled)
- Local-only mode requires no account
- Group membership is managed locally; sync links members via email/ID

### What we do NOT collect
- We do not collect item-level data for any advertising or third-party purpose
- Longitudinal analytics are computed on-device and stored locally
- No ML model training on user bill data without explicit opt-in

### Input validation
- All OCR output is treated as untrusted input — validated against schema before use
- Bill totals are recomputed from line items + charges + taxes and cross-checked against parsed total
- Currency and country fields are enum-constrained, not free text

---

## Key Architectural Tradeoffs

### Local-first vs cloud-first
**Chose:** Local-first (SQLite primary) + Supabase sync from day one.
**Why:** Group sync is a core requirement — members need to see each other's bills in real time. SQLite on-device is the primary store (app works offline, reads are fast, no round-trips for split math). Supabase is the sync and auth layer: bill data, group membership, and settlements replicate to Supabase so all group members stay in sync. Receipt images never leave the device (OCR is on-device via ML Kit). Aggregate user analytics telemetry (spend trends, retention signals across users) is a V2 addition on top of the same Supabase instance.

### Rule-based split engine vs ML
**Chose:** Fully deterministic rule engine for all split math.
**Why:** Financial calculations must be auditable. ML is appropriate for data extraction and insight generation — not for deciding what someone owes.

### Single bill schema for all bill types vs type-specific schemas
**Chose:** Single schema with type-specific field population.
**Why:** Downstream systems (split engine, UI, settlement) operate on one contract. Type-specific schemas would create parallel code paths and make the general/custom bill type impossible to model cleanly.

### OCR as draft vs OCR as final
**Chose:** OCR is always a draft, confidence-gated user correction.
**Why:** Trust is built by being quietly right and only asking when uncertain. Forcing full review kills the UX advantage of OCR.

### ML Kit on-device vs Ollama vs Cloud LLM for OCR
**Chose:** ML Kit on-device (Google ML Kit, ~15MB library).
**Why three-way decision:**
- **Ollama** cannot run on Android or iOS — it is a desktop/server runtime. Not viable for a mobile-first product.
- **Cloud LLM vision APIs** (OpenAI, Gemini) send receipt images to third-party servers retained for up to 30 days. Receipts contain card digits, locations, purchase patterns — sensitive financial data. This violates our privacy-first principle and our users' reasonable expectations.
- **ML Kit** runs fully on-device, works on Android and iOS natively, adds ~15MB to app size, requires no network call, and keeps every receipt image on the user's device permanently.

The parsing intelligence lives in our code (text → structured bill JSON), not in a heavyweight model. This is more controllable, testable, and auditable than prompt-engineering a vision model.

---

## System Thinking Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-05-10 | Money math is never ML | Auditability and user trust are non-negotiable for financial calculations |
| 2026-05-10 | Single bill schema for all types | Prevents parallel code paths and ensures the split engine has one contract |
| 2026-05-10 | Per-person breakdown is engine output, not UI computation | Keeps explainability correct, testable, and decoupled from rendering |
| 2026-05-10 | Local-first with optional Supabase sync | Privacy + zero-friction onboarding without sacrificing group sync capability |
| 2026-05-10 | India + USA only, no cross-currency | Scope control; cross-currency adds dispute surface and exchange rate complexity |
| 2026-05-10 | Pre-bill rule templates for recurring types | Eliminates repeated data entry for utility/subscription bills — key friction point |
| 2026-05-11 | ML Kit on-device OCR, not Ollama or cloud LLM | Ollama doesn't run on mobile; cloud LLMs retain receipt images (sensitive data); ML Kit is private, ~15MB, on-device, Android + iOS |
