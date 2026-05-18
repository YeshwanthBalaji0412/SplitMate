# SplitMate

> Transparent, itemized bill splitting — built for real bills, real groups, real clarity.

---

## Why SplitMate?

Every bill splitter tells you what you owe. None of them tell you **why**.

SplitMate is built on one principle: every rupee and dollar in a group expense must be fully traceable — from the original bill line item, through tax and fee allocation, to the final settlement. No black boxes.

**Who it's for:** College students, friend groups, colleagues — people in ongoing financial relationships who want to stay honest and ahead of their shared spending.

**Markets:** India (INR, GST) and USA (USD, state sales tax). Country-aware from the ground up.

---

## What Makes It Different

| Problem with existing apps | SplitMate's answer |
|---|---|
| Splits the total, not the bill | Item-level assignment with swipe-to-claim UX |
| Ignores fee complexity | Fee rule engine: delivery, platform, service, tax — each allocated correctly |
| "You owe $18" with no breakdown | Personal receipt per person — every line explained |
| Settlement with no context | Traceability: which bills, which items, why this person |
| No memory of group spending | Longitudinal intelligence: fairness tracking, trends, patterns |

---

## Bill Categories

- **Restaurant / Dining** — itemized, tip or service charge, GST/sales tax
- **Grocery** — itemized, tax by item category
- **Food Delivery** — items + delivery fee + platform fee + surge, country-aware fee rules
- **Utilities** — flat total, rules set once and reused (by room, person, usage %)
- **Subscriptions / Entertainment** — flat, one-time or recurring, equal or tiered
- **General / Custom** — freeform, user-defined rules

---

## Core Features

- Swipe-to-claim item assignment — fast, works for any bill type
- Fee rule engine — configurable allocation per fee type, country-aware (GST/sales tax)
- Per-person explainability view — receipt-style breakdown, every line traced
- Settlement traceability — debt graph with source bill context
- Settlement optimization — minimize transactions, visually explained
- OCR receipt parsing — on-device via ML Kit, confidence-scored draft with correction UX
- Group financial intelligence — spending trends, fairness scores, settlement behavior
- Spending personality — data-backed, subtle (Splurger / Even-Steven / Optimizer / Settler)
- Pre-bill rule templates — set utility/subscription rules once, reuse forever

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native + Expo (Android + iOS) |
| Web | Next.js, TypeScript, Tailwind CSS (post-MVP) |
| Backend | Supabase (Postgres, Auth, Storage) — sync layer |
| Local store | SQLite via Expo — primary store, offline-first |
| OCR | Google ML Kit (on-device, ~15MB, zero network calls, receipt never leaves device) |
| Split engine | Rule-based, deterministic, fully auditable — no ML in the money layer |
| Analytics | On-demand computation from local bill data — no persistent cache |

---

## Team

**Yeshwanth (SWE Lead)** — architecture, schema, split engine, settlement optimizer, mobile app, backend

**Sruthi (MLE Lead)** — OCR pipeline, item classification, confidence scoring, longitudinal intelligence, spending analytics

---

## Build Status

| Component | Status |
|---|---|
| Data schema (migrations 001 + 002) | ✅ Complete |
| Split engine + settlement optimizer | ✅ Complete |
| OCR parser (classify → extract → parse, 91 tests) | ✅ Complete |
| Analytics Layer 2 (aggregator, personality, storage, export, 53 tests) | ✅ Complete |
| ML Kit scan → bill entry pre-fill + correction UX | ✅ Complete |
| Monthly report screen | ✅ Complete |
| Mobile app screen skeleton | ✅ Complete |
| Split engine wired into bill assignment flow | ⏳ In progress (SWE) |
| Settlement optimizer wired to settlement screen | ⏳ In progress (SWE) |
| Real-device QA | ⏳ Pending |

> **Engineers:** See [TRACKER.md](TRACKER.md) for current status, next actions, and a map of all project docs.

---

## Project Docs

| File | Purpose |
|---|---|
| [TRACKER.md](TRACKER.md) | **Start here** — live status, next actions, doc map |
| [PLAN.md](PLAN.md) | Full product roadmap — MVP/V1/V2, feature rationale |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design decisions and tradeoffs |
| [MLE.md](MLE.md) | MLE implementation log — OCR, analytics, design decisions |
| [SWE.md](SWE.md) | SWE implementation log — split engine, schema, mobile |
