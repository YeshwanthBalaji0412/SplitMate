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

Supports 6 real-world bill types + a general custom format:

- **Restaurant / Dining** — itemized, tip or service charge, GST/sales tax
- **Grocery** — itemized, tax by item category
- **Food Delivery** — items + delivery fee + platform fee + surge, country-aware fee rules
- **Accommodation / Travel** — flat or per-night, equal or rule-based split
- **Utilities** — flat total, rules set once and reused (by room, person, usage %)
- **Subscriptions / Entertainment** — flat, one-time or recurring, equal or tiered
- **General / Custom** — freeform, user-defined rules

---

## Core Features

- Swipe-to-claim item assignment — fast, works for any bill type
- Fee rule engine — configurable allocation per fee type
- Per-person explainability view — receipt-style breakdown
- Settlement traceability — debt graph with source bill context
- Settlement optimization — minimize transactions, visually explained
- Group financial intelligence — spending trends, fairness scores, settlement behavior
- Subtle gamification — settlement streaks, spending personality (data-backed)
- OCR receipt parsing — photo, screenshot, or PDF upload with confidence-scored drafts
- Pre-bill rule templates — set utility/subscription rules once, reuse forever

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web | Next.js, TypeScript, Tailwind CSS |
| Mobile | React Native + Expo |
| Backend | Supabase (Postgres, Auth, Storage) |
| OCR | Google ML Kit (on-device, ~15MB, Android + iOS, zero network calls) |
| Split Engine | Rule-based, deterministic, fully auditable |

---

## Team

**Software Engineering Lead** — architecture, frontend, backend, split engine, settlement optimizer

**ML Engineering Lead** — OCR pipeline, item classification, confidence scoring, longitudinal intelligence, spending analytics

---

## Status

| Milestone | Status | Date |
|---|---|---|
| Vision and architecture design | ✅ Complete | May 2026 |
| Bill data model and schema | 🔄 In Progress | — |
| Split engine core | — | — |
| OCR pipeline v1 | — | — |
| Web app MVP | — | — |
| Mobile app | — | — |

---

*See [ARCHITECTURE.md](ARCHITECTURE.md) for system design decisions. See [MLE.md](MLE.md) and [SWE.md](SWE.md) for domain-specific engineering logs.*
