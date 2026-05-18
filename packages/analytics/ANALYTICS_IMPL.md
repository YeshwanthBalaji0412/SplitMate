# Analytics — Implementation Log

> Design decisions, data model rationale, and implementation notes for the Layer 2 intelligence pipeline.
> Updated as each module is built and tested.

---

## What Layer 2 Is

Layer 1 = per-bill intelligence (OCR parsing, item classification, fee allocation). Runs at bill entry time.

Layer 2 = longitudinal intelligence. Runs on stored bill data across time. Answers questions like:
- What is this user's spending pattern across groups?
- Are they consistently overpaying or underpaying their fair share?
- What kind of spender are they?
- How much storage is their bill data using and what can be freed?

Layer 2 never generates data — it reads what Layer 1 and the split engine already produced.

---

## Architecture

```
SQLite (local bill store)
    ↓ caller fetches BillRecord[]
computeMonthlyReport(userId, bills, window)
    ├── computeCategoryBreakdown()   ← spending by bill type
    ├── computeGroupSummaries()      ← per-group breakdown
    ├── computeFairnessDelta()       ← over/under paying signal
    ├── computeAvgDaysToSettle()     ← settlement behaviour
    ├── computeSettlementStreak()    ← streak of 48hr settlements
    └── derivePersonality()          ← spending type (5+ bills required)
    ↓
MonthlyReport                       ← rendered on report screen
    ↓ user action
    ├── exportToJSON() / exportToCSV()  ← download to device
    └── getArchivableBills()            ← identify what can be deleted
```

**Key principle:** All computation is in-memory. The analytics package takes arrays, does math, returns objects. It never touches a database directly — the caller (mobile app) fetches from SQLite and passes data in. This makes every function unit-testable with plain data.

---

## Storage Model Decision

**On-demand computation, no persistent analytics cache.**

Why not pre-compute and cache analytics after every bill?
- At realistic bill volumes (tens per month) SQLite aggregation queries run in <50ms — pre-computing buys nothing
- Cached analytics can go stale (if a bill is edited or deleted) — on-demand is always correct
- Eliminates a whole category of sync bugs between raw data and derived state
- Simpler code — no cache invalidation logic

**User storage lifecycle:**
1. Bill data stored locally (always — source of truth for splits)
2. After settlement: bill remains locally, no urgency to delete
3. After 3 months settled: eligible for archiving
4. Before archiving: app prompts to download report (JSON/CSV)
5. After archiving: bill data deleted, storage freed
6. Analytics still computable on demand from remaining bills

---

## Module Specifications

### aggregator.ts

**`computeMonthlyReport(userId, bills, window)`**
- Filters bills to the time window
- Filters to bills where `userId` is a participant
- Calls all sub-functions and assembles `MonthlyReport`
- Returns zero/null for fields with insufficient data (never throws on empty input)

**`computeCategoryBreakdown(userId, bills)`**
- Groups bills by `billType`
- For each group: sum of `owedAmount` for userId, count of bills
- Computes `percentOfTotal` from sum / total across all categories
- Sorted descending by totalSpent

**`computeGroupSummaries(userId, bills)`**
- Groups bills by `groupId`
- For each group: total spent (sum owed), bill count, most frequent bill type
- Sorted descending by totalSpent

**`computeFairnessDelta(userId, bills)`**
- For each bill: equal share = totalAmount / participantCount
- User's actual owed amount vs equal share → delta per bill
- Returns mean delta across all bills
- Positive = user overpaid on average; negative = underpaid
- `fairnessLabel`: `even` if |delta| < 5% of mean bill value, else `overpaying` / `underpaying`

**`computeAvgDaysToSettle(userId, bills)`**
- Only considers bills with `settledAt` not null
- Days = (settledAt - bill date) in calendar days
- Returns null if no settled bills in window

**`computeSettlementStreak(bills)`**
- Counts consecutive calendar days where ALL bills settled that day were settled within 48 hours of creation
- Resets to 0 if any bill took longer than 48 hours
- Streak is a group-level metric — pass bills from one group at a time

---

### personality.ts

**`derivePersonality(userId, bills)`**
- Requires minimum 5 bills lifetime (not just in window) — returns null below threshold
- Scoring is deterministic — same bills always produce same personality

**Scoring dimensions:**

| Dimension | How measured |
|---|---|
| Splurge score | User's avg item total as % of group avg item total |
| Fairness score | Inverse of absolute fairness delta |
| Speed score | Avg days to settle (lower = faster = higher score) |
| Equal-split score | % of bills where user claimed no specific items (pure equal split) |

**Personality assignment:**

| Type | Dominant signal |
|---|---|
| **Splurger** | Splurge score > 1.2 (consistently orders 20%+ more than group avg) |
| **Even-Steven** | Equal-split score > 0.7 (70%+ bills with no item claims) |
| **Optimizer** | Splurge score < 0.8 AND fairness delta < 0 (orders less, underpays) |
| **Settler** | Speed score top quartile AND fairness score > 0.8 |

If no dimension is dominant, use the highest scoring type. Ties broken by recency (most recent bills weighted slightly higher).

---

### storage.ts

**`estimateStorage(bills)`**
- Estimates bytes: ~500 bytes per bill record (items, charges, participants serialised)
- Returns `StorageEstimate` with total, settled count, unsettled count, archivable count

**`getArchivableBills(bills, asOf)`**
- Settled at least `ARCHIVE_AFTER_MONTHS` (3) months before `asOf`
- Never returns unsettled bills regardless of age

---

### exporter.ts

**`exportToJSON(userId, report, bills)`**
- Wraps `MonthlyReport` + raw bills in `AnalyticsExport`
- Serialises to pretty-printed JSON string
- Caller writes to device filesystem

**`exportToCSV(userId, report, bills)`**
- One row per bill the user participated in
- Columns: date, group ID, bill type, total amount, your share, settled (yes/no)
- Header row included
- RFC 4180 compliant (quoted strings, CRLF line endings)

---

## Design Decisions

### 2026-05-14 — On-demand computation, no persistent cache
Analytics are computed fresh each time from local bill data. No pre-computed state. Rationale: query speed is negligible at realistic volumes; caches go stale; simpler code.

### 2026-05-14 — Analytics package is DB-agnostic
The package takes plain arrays, returns plain objects. Zero database calls inside the package. This keeps every function unit-testable with hardcoded test data and decouples analytics from whatever DB the SWE uses (SQLite, Supabase, etc.).

### 2026-05-14 — Minimum 5 bills for personality, 5 for fairness
Below these thresholds the signal is too noisy to be meaningful. Surfacing a "personality" based on 2 restaurant bills would be wrong and could mislead users. We show nothing rather than showing something unreliable.

### 2026-05-14 — Fairness delta uses equal-share baseline, not computed fair share
We compare each user's actual owed amount to a simple equal split of the total. Why not compare to the itemized fair share? Because the itemized fair share IS what they owed — comparing to it always gives delta = 0. The meaningful question is: compared to splitting everything equally, are you ordering more or less than your group average?

### 2026-05-14 — Settlement streak is group-level, not user-level
A streak measures the group's reliability, not an individual's. It resets when ANY bill in the group takes longer than 48 hours. This is a trust signal for the group, not a performance metric for a person.

### 2026-05-14 — Archive threshold is 3 months post-settlement
3 months gives users enough time to notice a dispute, review their history, and download their report if they want it. Bills settled yesterday should not be deletable — the user might still need them for reference.

---

## Test Strategy

Every function is tested with:
1. **Empty input** — zero bills, zero participants — should return zero/null gracefully, never throw
2. **Single bill** — boundary case
3. **Multi-bill, multi-group** — main case
4. **Edge cases specific to each function** (listed below)

Edge cases by function:
- `computeFairnessDelta`: all bills equal split (delta = 0), one massive outlier bill
- `computeAvgDaysToSettle`: no settled bills (returns null), same-day settlement (0 days)
- `computeSettlementStreak`: streak interrupted midway, all bills within 48hrs, no bills
- `derivePersonality`: exactly 5 bills (threshold boundary), tied scores
- `getArchivableBills`: bills settled exactly on the threshold date, no settled bills
- `exportToCSV`: items with commas in names (must be quoted), currency symbols

---

## Status

| Module | Status | Tests |
|---|---|---|
| `types.ts` | Complete | — (types only) |
| `aggregator.ts` | Complete | 32 tests |
| `personality.ts` | Complete | — (covered via aggregator integration) |
| `storage.ts` | Complete | 11 tests |
| `exporter.ts` | Complete | 10 tests |

*Last updated: 2026-05-18*
