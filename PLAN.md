# SplitMate — Product Roadmap

> Every decision here has a rationale. We build what proves the core value first, then layer intelligence on top of a proven foundation.

---

## North Star

> For any real-world bill — restaurant, grocery run, food delivery, or utility — a group of friends can enter it, assign it, split it fairly with every fee allocated correctly, see exactly what they owe and why, and settle with full clarity on which bills their money covers. This works even if OCR is completely off.

---

## MVP — Prove the Core (Mobile: Android + iOS)

**Goal:** One person in a group pays a bill, everyone sees exactly what they owe and why, and the group settles with zero ambiguity.

**Success criterion:** A group of 4 friends can split a Zomato delivery receipt — items, delivery fee, platform fee, GST — correctly and transparently, in under 3 minutes, without needing a calculator or a follow-up "wait how did you get that number?"

### Features

**Groups**
- Create group: name, currency (INR/USD), country (India/US), settlement mode (optimized/direct)
- Invite via shareable code — no forced signup to join
- Group types: roommates, trip, household, event, other

*Rationale:* Invite code is non-negotiable. If onboarding 6 friends requires 6 account creations, the app dies at the first dinner. One link, tap to join.

---

**Bill Entry — Manual + Photo OCR**
- Manual entry always works, no AI required
- Photo/screenshot upload → Ollama local OCR → confidence-scored draft → user reviews flagged fields only
- All paths produce the same bill JSON — OCR is a pre-fill, never the final word

*Rationale:* PDF upload is cut from MVP. Photo covers restaurant bills, grocery receipts, delivery screenshots. PDFs are e-bills — useful but not day-one critical. Manual entry ensures the product works even when OCR is bad. Two modalities is enough to launch.

---

**Bill Types: Restaurant, Grocery, Food Delivery, Utilities, Custom**

- **Restaurant/Dining** — itemized, tip (US) or service charge (India), GST/sales tax
- **Grocery** — itemized, tax by item category
- **Food Delivery** — items + delivery fee + platform fee + surge, proportional allocation by default
- **Utilities** — flat total, rule template set once per group and reused every bill
- **Custom** — freeform, user defines all rules; also covers accommodation and subscriptions until V1.5

*Rationale:* These are the 4 highest-frequency bill types for college students, roommates, and friend groups. Accommodation and subscriptions are cut — Custom handles them. Utility rule templates are kept because without them, roommates re-enter the same split every month and abandon the app.

---

**Swipe-to-Claim Item Assignment**
- Each line item is a card — swipe right to claim sole, tap to split with selected people
- Unassigned items default to equal split among all participants
- Summary screen shows each person's pile before confirming

*Rationale:* Every competitor either ignores item-level splitting or makes it a form. Swipe-to-claim is the interaction that makes assignment feel fast. Works for all bill types — not just food.

---

**Fee Rule Engine**
- Discount applied first (reduces base), then tax, then fees — order enforced by engine, not display position
- Default allocation rules per fee type: delivery proportional to order value, platform fee equal per person, tip/service proportional to subtotal, alcohol tax to alcohol claimants only
- User can override any rule per bill
- Country-aware: GST tiers for India, state sales tax for US

*Rationale:* This is the core technical differentiator. No competitor allocates fees correctly. The discount order-of-ops is enforced in code because real receipts vary — Swiggy discounts before tax, some apps after. Getting this wrong means allocating tax on money that was never charged.

---

**Per-Person Explainability View**
- Every participant sees a receipt-style breakdown of their share
- Every line traced: item subtotal → tax share → fee share → total
- Shareable as screenshot

*Rationale:* This is the product. "You owe ₹441" with no breakdown is Splitwise. "You owe ₹441 — here's exactly why" is SplitMate. Without this, the fee rule engine is invisible to the user.

---

**Settlement**
- Debt graph computed across all active bills in the group
- Optimized mode (default): minimum transactions, each payment traced to source bills
- Direct mode: pay exactly who you owe, no redirection to strangers
- Settlement view: who to pay, how much, which bills it covers, why
- Mark as settled manually — no payment integration in MVP

*Rationale:* Payment integration (UPI, GPay, Venmo) is cut. It introduces compliance, fraud surface, and trust overhead that a small team cannot absorb at launch. The value of MVP settlement is clarity — knowing what you owe and why. The actual payment happens outside the app. This is a deliberate scope decision, not an oversight.

---

## V1 — Make It Intelligent

**Goal:** The app gets meaningfully smarter with use. OCR becomes reliable. Recurring bills become zero-effort. Users start to understand their group spending patterns.

**Success criterion:** A user who has been using the app for 6 weeks gets genuine insight from it — not just a history log, but something they couldn't have seen otherwise.

### Features

**PDF Upload**
- Native text extraction for digital PDFs (Swiggy email receipts, utility PDFs)
- OCR fallback for scanned/image PDFs
- Same confidence + correction UX as photo upload

*Rationale:* Moved from MVP because photo covers launch needs. By V1, users are comfortable with the app and e-bill upload becomes the natural next convenience.

---

**Accommodation / Travel + Subscriptions bill types**
- Accommodation: flat or per-night split, Airbnb/hotel format
- Subscriptions: equal or tiered by plan, recurring flag

*Rationale:* Cut from MVP because Custom covers them. Added in V1 because dedicated forms reduce entry time and rule templates for subscriptions remove monthly re-entry pain.

---

**Spending Personality**
- Unlocked after 5+ bills in a group
- Four types: Splurger, Even-Steven, The Optimizer, The Settler
- One label, one line of context, optionally shareable

*Rationale:* Cut from MVP because there's no data on day one. By V1, users have history. This is low MLE effort — a few derived metrics — with high personality impact for the app. Shareable = organic growth.

---

**Group Financial Snapshot**
- Total group spend this month
- Your share vs group average
- Settlement streak — "settled within 48hrs for 4 weeks"
- Biggest expense category this month

*Rationale:* Cut from MVP because new users have no history to show. By V1 these numbers are real and meaningful. One screen, four metrics — no chart complexity yet.

---

**OCR Confidence Improvements**
- Evaluate PaddleOCR vs Tesseract on real India and US receipts
- Tune country-specific post-processing
- Track parse accuracy per bill type to identify weak spots

*Rationale:* MVP ships with best-effort OCR. V1 is when MLE has real user data to evaluate against and can systematically improve parse quality per bill type.

---

**Fairness Tracking (soft)**
- Per user per group: are you consistently over or under paying your fair share?
- Shown as a private insight, not pushed aggressively
- Minimum 8 bills before surface

*Rationale:* This is the longitudinal intelligence that no competitor has. Needs enough history to be accurate — hence V1 not MVP.

---

## V2 — Deepen Intelligence + Social Layer

**Goal:** SplitMate becomes the financial memory of a friend group. Insights are proactive, not just reactive.

### Features

- **Anomaly detection** — flag when a bill's fees are unusually high relative to order value, or when a split looks inconsistent with history
- **Full spending analytics dashboard** — category trends, month-over-month, per-person breakdowns
- **Settlement behavior insights** — how fast does your group pay back? Who's reliable?
- **Payment integration** — UPI deep links (India), Venmo/GPay links (US). No in-app payments — deep links only, keeps compliance surface minimal
- **Friend graph across groups** — see your net balance with a person across all shared groups
- **Recommendation engine** — "Priya usually claims the drinks, pre-assign?" Only when confidence is high and always overridable

---

## What We Are Deliberately Not Building

| Feature | Why never |
|---|---|
| Tax computation / liability | Compliance product — we allocate taxes already on the bill, never generate them |
| Cloud LLM OCR (OpenAI vision etc.) | Receipt images contain sensitive financial data; cloud APIs retain inputs up to 30 days. Ollama only. |
| Cross-currency / FX rates | Out of scope — India + USA only, groups are single-currency |
| In-app payments / wallets | Regulatory and fraud surface too large for this team and this product |
| Multi-language UI | Post V2 — focus on English for India and US markets first |

---

## Timeline Thinking

No hard dates — this is a two-person team with day jobs. Milestones not sprints.

| Phase | Done when |
|---|---|
| **MVP** | A real group can split a real delivery receipt end-to-end and settle with full traceability |
| **V1** | A 6-week-old user gets a spending insight they find genuinely useful |
| **V2** | The app proactively surfaces something a user didn't know to ask for |

---

## Open Decisions (pre-MVP)

- [ ] Local-first storage: SQLite (local) + optional Supabase sync — architecture decision needed before any data work
- [ ] Minimum Ollama model for MVP OCR quality: evaluate phi-3-vision vs llava vs moondream on receipt images
- [ ] Settlement traceability: requires `settlement_expense_links` junction table — flag to SWE before schema is finalized
- [ ] `country` field on groups: missing from current schema — blocker for tax rule engine

---

*Owned by: Sruthi (MLE) + SWE Lead*
*Last updated: 2026-05-11*
*Cross-reference: [ARCHITECTURE.md](ARCHITECTURE.md) · [MLE.md](MLE.md) · [SWE.md](SWE.md)*
