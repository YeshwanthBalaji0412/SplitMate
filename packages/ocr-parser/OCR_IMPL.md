# OCR Parser — Implementation Log

> This document tracks every real-world issue we found, what caused it, and exactly how we fixed it.
> Updated as we test more receipts. Serves as the design reference for the OCR pipeline.

---

## Architecture

```
ML Kit (on-device, ~15MB)
    ↓ raw text lines (RawLine[])
mergeWrappedLines()       ← pre-processor: joins split item names
    ↓
classifyLines()           ← labels each line: item | tax_line | fee_line | ...
    ↓
extractFields()           ← pulls structured data, country-aware
    ↓
parseReceipt()            ← orchestrates, flags low-confidence fields
    ↓
ParsedBillDraft           ← JSON draft shown to user for review
```

**Key principle:** OCR output is always a draft. Every field has a confidence score. Fields below threshold (default 0.75) go into `flaggedFields` — shown to user for correction. High-confidence fields are pre-filled silently.

**Country modes:** `IN` (India) and `US` (USA). Set at group creation. Drives tax parsing, GST vs sales tax detection, and tip vs service charge labeling.

---

## Receipt Fixtures Tested

| File | Type | Market | Issues Found |
|---|---|---|---|
| `in-delivery-01.txt` | Food delivery | India | 4 issues (all fixed) |
| `in-restaurant-01.txt` | Restaurant | India | 6 issues (in progress) |

---

## Issues Found and Fixed

---

### FIXED — Issue 1: Container Charge misclassified as item
**Receipt:** in-delivery-01.txt
**Symptom:** `"Container Charge 30.00"` → classified as `item`, appeared in items array
**Root cause:** `fee_line` pattern bank didn't include container/packaging charge keywords
**Fix:** Added `/\bcontainer\s*(fee|charge)?\b/i` and `/\bpackaging\s*(fee|charge)?\b/i` to `PATTERNS.fee_line` in `classifier.ts`
**Also fixed in:** `buildChargeType` in `extractor.ts` — container/packaging now maps to `service_fee` type

---

### FIXED — Issue 2: Column header row treated as merchant name
**Receipt:** in-delivery-01.txt
**Symptom:** `"Item Qty. Price Amount"` → classified as `merchant_name` (first line heuristic)
**Root cause:** First non-empty line is assumed to be the merchant name; header rows aren't filtered before this heuristic runs
**Fix:** Added header row patterns to `PATTERNS.noise` in `classifier.ts`:
```
/\b(qty|quantity)\b.{0,30}\b(price|amount|rate|amt)\b/i
/\bitem\b.{0,20}\b(qty|price|amount)\b/i
/\bdescription\b.{0,30}\b(qty|rate|amount)\b/i
```
Noise is checked before the first-line merchant heuristic, so header rows are silenced correctly.

---

### FIXED — Issue 3: Item names included Qty/Price columns from ML Kit row format
**Receipt:** in-delivery-01.txt
**Symptom:** `"Chicken Wings (4 Pc) 1 150.00 150.00"` → name was `"Chicken Wings (4 Pc) 1 150.00"` (columns not stripped)
**Root cause:** ML Kit returns full receipt row as one text line. `cleanItemName` only stripped the final price, not the intermediate qty and unit-price columns.
**Fix:** Added second strip in `cleanItemName` in `extractor.ts`:
```ts
cleaned = cleaned.replace(/(\s+\d+(?:\.\d{1,2})?)+$/, '').trim();
```
Strips any trailing standalone numbers after the price is removed.

---

### FIXED — Issue 4: Multi-line item name split across two ML Kit lines
**Receipt:** in-delivery-01.txt
**Symptom:** `"Special Chicken"` (line with no price) was classified as noise; only `"Shawarma In Rumali"` (line with price) appeared as item
**Root cause:** Classifier sees each line independently. A name-only line with no price falls through to `noise`.
**Fix:** Added `mergeWrappedLines()` pre-processor in `classifier.ts`, runs before classification:
- If current line has letters, no price, and next line has a price → merge them into one line
- Skip first content line (merchant name is never a wrapped item continuation)
- Skip separator lines (`----`, `====`) even if they have no price

---

### FIXED — Issue 5: Charge label included trailing price string
**Receipt:** in-delivery-01.txt
**Symptom:** `label: "Container Charge 30.00"` instead of `"Container Charge"`
**Root cause:** `cleanChargeLabel` built regex from `amount.toString()` which gives `"30"`, but the text had `"30.00"` — no match
**Fix:** Replaced exact-match regex with a broad trailing price pattern in `extractor.ts`:
```ts
.replace(/\s*[₹$]?\s*\d{1,6}(?:[.,]\d{1,2})?\s*$/, '')
```

---

### FIXED — Issue 6: Address lines parsed as items
**Receipt:** in-restaurant-01.txt
**Symptom:** `"16, SIVASAKTHI NAGAR, THUDIYALUR ROAD..."` → item with price `37` (from `-37` in `CBE-37`). Phone number line → item with price `48255`.
**Root cause:** Address lines contain numbers (pin codes, area codes) that match the price pattern. No address/phone detection in classifier.
**Fix:** Added address and phone noise patterns to `PATTERNS.noise` in `classifier.ts`:
- `/\bnagar\b|\bstreet\b|\broad\b|\blane\b.../i` — address keywords
- `/\b(ph|phone|mob|mobile|tel|fax)\s*(no|num|number)?[\s:.]/i` — phone lines
- `/\bbill\s*no\b|\breceipt\s*no\b.../i` — receipt metadata
- `/\btime\s*:/i` — TIME: 18:25
- `/^\s*p\s*$/i` — standalone "P" line (thermal printer artifact)
- `/\btotal\s*item/i`, `/\/qty/i` — "TOTAL ITEM(S): 4 /QTY:16"

---

### FIXED — Issue 7: TIME line parsed as item
**Receipt:** in-restaurant-01.txt
**Symptom:** `"TIME: 18:25"` → item with price `25`
**Root cause:** `18:25` — the `25` at the end matches the price regex
**Fix:** Added `/\btime\s*:/i` to `PATTERNS.noise` — catches `TIME: 18:25` before item classification

---

### FIXED — Issue 8: GSTIN + BILL NO line parsed as item
**Receipt:** in-restaurant-01.txt
**Symptom:** `"GST33APXPN 22J BILL NO: 190"` → item with price `190`
**Root cause:** GSTIN partial noise match didn't cover the full line including trailing BILL NO
**Fix:** Added `/\bbill\s*no\b/i` to `PATTERNS.noise` and improved GSTIN pattern to catch the full alphanumeric string

---

### FIXED — Issue 9: SI (serial) numbers not stripped from item names
**Receipt:** in-restaurant-01.txt
**Symptom:** `"2 CHICKEN 65 1Pk"` — leading `2` treated as part of name
**Root cause:** `extractQuantityAndName` only handled `Nx` and `xN` quantity formats
**Fix:** Added `stripSerialNumber()` in `extractor.ts` — strips leading digit followed by a letter word:
```ts
text.replace(/^\d+\s+(?=[A-Za-z])/, '').trim()
```
Called before `extractQuantityAndName` in the item extraction flow.

---

### PARTIALLY FIXED — Issue 10: Pk quantity suffix not recognised
**Receipt:** in-restaurant-01.txt
**Symptom:** `"9Pk"`, `"1Pk"` not parsed as quantity
**Root cause:** `extractQuantityAndName` only handled `Nx` and `xN` formats
**Fix:** Added `UNIT_SUFFIX_RE` in `extractor.ts` for `Pk, Pcs, Nos, Kg, Gm, L, Ml`
**Remaining:** `Pk` suffix appears in the middle of the cleaned name (`"PAROTTA 9Pk"`) not at the start, because it follows the item name. `cleanItemName` strips trailing numbers but `9Pk` is not a trailing number — it's mid-string. Full fix requires detecting and stripping unit suffixes from mid-name positions. Currently `Pk` stays in the name but is accepted — user can correct.

---

### FIXED — Issue 11: GST-inclusive pricing not flagged
**Receipt:** in-restaurant-01.txt
**Symptom:** GST ₹38.57 is already baked into ₹810 total — if treated as additive charge, split engine would inflate totals
**Root cause:** Indian bills show GST as an informational breakdown of included tax, not as an additional charge
**Fix:** Added `gstInclusive?: boolean` to `ParsedCharge` type. In `extractFields`, after subtotal inference: if `Math.abs(itemSubtotal - total) < 1.00`, all `sales_tax` charges are marked `gstInclusive: true` and charge confidence is capped at 0.65 to force user review.

---

### KNOWN REMAINING — Issue 12: Tax data row (pure numeric) loses GST amount
**Receipt:** in-restaurant-01.txt
**Symptom:** `"5.00 771.43 19.29 19.29 38.57"` — pure numeric row correctly silenced as noise, but GST amount (38.57) is lost
**Root cause:** Tax data row has no keywords — classified as noise by `isPureNumericRow()`. The amount only appears here, not in a labelled GST line.
**Behaviour:** `charges: []`, flagged for user review. User adds GST manually. Safe — better to flag than to guess.
**Future fix:** Parse tax table by detecting the header row (`TAX % TAXABLE VAL CGST SGST TAX AMOUNT`) and reading the data row immediately following it as a structured pair.

---

## Known Limitations (by design)

| Limitation | Why we accept it |
|---|---|
| No tax computation | We allocate taxes already on the bill — never generate them. Avoids compliance scope. |
| OCR accuracy depends on image quality | ML Kit is best-effort. Low-confidence fields are always flagged for user review. |
| 2-digit years ambiguous | `07/09/25` — we normalise to current century (20xx). Flagged for user review. |
| Multi-currency not supported | India (INR) and USA (USD) only. No cross-currency groups. |
| Handwritten receipts | Not supported in v1. ML Kit handles printed text only. |

---

## Confidence Score Reference

| Score | Meaning |
|---|---|
| 0.90–0.95 | Very high — keyword is unambiguous (CGST, SGST, Grand Total) |
| 0.80–0.89 | High — strong pattern match (tip, delivery fee, merchant name by position) |
| 0.75–0.79 | Medium-high — item line with price at end |
| 0.65–0.74 | Medium — inferred field (subtotal from item sum) |
| 0.40–0.64 | Low — fallback classification, flag for user review |
| 0.20 | Very low — field present but value unparseable (e.g. date format not recognised) |
| 0.00 | Field not found at all — always flagged |

Default threshold for flagging: **0.75**
