# SplitMate Demo Script

> **Target:** 3 minutes, web browser, two accounts.
> **Fallback:** if OCR is unavailable on web (expected), use manual entry.
> **Rule:** never open Supabase dashboard, terminal, or code during the demo.

---

## Pre-demo checklist

- [ ] Dev server running: `cd apps/mobile && npx expo start --web`
- [ ] Two browser windows open (one normal, one incognito)
- [ ] Both accounts signed in (Account A = presenter, Account B = friend)
- [ ] At least one group exists with both accounts as members
- [ ] At least 2 settled bills already in the group (for analytics)
- [ ] Browser console closed (no debug noise)

---

## Minute 0:00 – 0:30 — The Problem

**What to say:**
> "Every bill splitter tells you what you owe. None of them tell you WHY.
> SplitMate traces every dollar from the original bill line, through tax
> and fee allocation, to the final settlement. No black boxes."

**Show:** Dashboard with your groups listed. Tap into the demo group.

---

## Minute 0:30 – 1:30 — Add a Bill + Assign Items

**What to say:**
> "Let's split a real dinner bill."

**Steps (Account A):**
1. Group home → **"Add Bill"**
2. Title: `Friday Dinner` — Date: today — Type: **Restaurant**
3. Add items:
   - `Grilled Salmon` — Qty 1 — $24.00
   - `Caesar Salad` — Qty 1 — $14.00
   - `IPA Beer` — Qty 1 — $8.00
4. Add charges:
   - **Tax** — $3.68
   - **Tip** — $9.00
5. Confirm both members included, paid by = you → **Save & assign items**
6. Assignment screen:
   - Tap **your name** on Salmon (sole claim)
   - Tap **both names** on Salad (shared)
   - Tap **your name** on IPA Beer (sole claim — this is alcohol!)
7. **"Confirm assignments"**

**What to say:**
> "Each person sees exactly what they owe — item by item, with their
> share of tax and tip allocated proportionally. The beer tax only
> goes to whoever ordered it."

**Show:** Bill detail screen — per-person breakdown with item + tax + tip lines.

---

## Minute 1:30 – 2:15 — Settle Up

**Switch to Account B (incognito window).**

**Steps:**
1. Group home → **"Settle Up"**
2. See the transfer card: `B → A · $XX.XX`
3. Point out the **"covers: Friday Dinner"** traceability line
4. Tap **"Mark as paid"**

**What to say:**
> "One tap to settle. Every payment traces back to the bills it covers.
> If you had 5 bills open, this screen shows the MINIMUM number of
> transfers needed — not one per bill."

**Show:** "All settled!" empty state after marking paid.

---

## Minute 2:15 – 3:00 — Analytics + Group Stats

**Switch back to Account A.**

**Steps:**
1. Dashboard → **"📊 My Report"**
2. Show: total spent, category breakdown (restaurant bar), settlement streak
3. If 5+ bills exist: point out the **spending personality** card
4. Back → Group home → **"Group Stats"**
5. Show: group total, your share vs average (green/red delta), top category

**What to say:**
> "Over time, SplitMate becomes the financial memory of your group.
> It knows your spending patterns, tracks fairness, and shows who
> settles fast. No spreadsheet needed."

---

## Backup plans

| Scenario | Action |
|---|---|
| **OCR scan fails** (expected on web) | Say: "On a phone, you'd scan the receipt and it auto-fills. For this demo, I'll type it in — same engine underneath." Use manual entry. |
| **Network error on save** | Check `.env` is loaded. Refresh page. Retry. |
| **Settlement screen empty** | You need at least one unsettled bill. Create a quick bill first. |
| **Analytics report empty** | Need 1+ bills. Create + settle a bill, then reopen report. |
| **Someone asks about OCR** | Say: "OCR runs on-device via Google ML Kit — zero network calls, receipt never leaves your phone. Confidence scoring flags uncertain fields for review." |

## What NOT to do during demo

- Do not open the terminal or Supabase dashboard
- Do not show code or the file tree
- Do not try to create new accounts (rate limit)
- Do not demo on iOS simulator (no simulator available; web is the demo target)
- Do not mention "Phase X" or internal build terminology
- Do not show settlement edge cases (partial payments, optimized rerouting)
