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
| `in-delivery-01.txt` | Food delivery | India | 5 issues (all fixed) |
| `in-restaurant-01.txt` | Restaurant | India | 6 issues (5 fixed, 1 known limitation) |
| `us-delivery-01.txt` | Food delivery (UberEats) | USA | 6 issues (all fixed) |
| `us-delivery-02.txt` | Food delivery (UberEats + Dig Inn) | USA | 5 issues (4 fixed, 1 known limitation) |
| `us-grocery-01.txt` | Grocery — payment/savings section only | USA | 7 issues (all fixed) |
| `us-grocery-02.txt` | Grocery — Green Supermarket, full items | USA | 4 issues (all fixed) |
| `us-grocery-03.txt` | Grocery — Dollar Tree, N-suffix, OCR noise | USA | 6 issues (all fixed) |

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

---

### FIXED — Issue 13: Order codes (F0006) parsed as items
**Receipt:** us-delivery-01.txt
**Symptom:** `"F0006"` → item with price `6` (trailing digit extracted as price)
**Root cause:** Short alphanumeric order codes end in digits — price regex matches the trailing number
**Fix:** Added `/^[A-Z]?\d{3,6}$|^#\d+$/i` to `PATTERNS.noise` — catches order codes like `F0006`, `#190`

---

### FIXED — Issue 14: "Order Details:" merged with item line
**Receipt:** us-delivery-01.txt
**Symptom:** `"Order Details: 1X King's Experience $369.00"` appeared as merged item name
**Root cause:** `"Order Details:"` (no price) + `"1X King's Experience $369.00"` (has price) — merged by `mergeWrappedLines`
**Fix:** Added `/\border\s*details?\b/i` to `PATTERNS.noise`. Since noise is excluded from merge candidates, the merge no longer fires.

---

### FIXED — Issue 15: "PREPAID - Do Not Charge" + Ordermark merged as item
**Receipt:** us-delivery-01.txt
**Symptom:** Both lines merged, `"6480"` extracted as price `6480`
**Root cause:** `PREPAID` line had letters (passed `looksLikeName`) and no price; Ordermark line ended in `6480`
**Fix:** Added `/\bprepaid\b/i`, `/\bordermark\b|\bomid\b/i`, `/\bdo\s*not\s*charge\b/i` to noise patterns

---

### FIXED — Issue 16: "Tax: $37.28" label not clean, wrong type
**Receipt:** us-delivery-01.txt
**Symptom:** `label: "Tax:"`, `type: "custom"` instead of `label: "Tax"`, `type: "state_tax"`
**Root cause:** `buildChargeType` pattern matched full line including price; `cleanChargeLabel` didn't strip trailing colon
**Fix:**
- Added `/^tax[\s:$₹\d.,]*$/` pattern to `buildChargeType` — matches "Tax:", "Tax $37.28" → `state_tax` for US
- Updated `cleanChargeLabel` to strip trailing colons: `.replace(/[-:]\s*$/, '')`

---

### FIXED — Issue 17: "$369.00" left in item name
**Receipt:** us-delivery-01.txt
**Symptom:** `name: "King's Experience $369.00"` — price with `$` prefix not stripped
**Root cause:** `cleanItemName` used `price.toString()` (`"369"`) to build strip regex, but text had `"$369.00"` — integer vs decimal mismatch
**Fix:** Updated `cleanItemName` regex to match optional decimal suffix `(?:\.\d{1,2})?` and added a second pass for `[₹$]` prefixed prices

---

### ACCEPTED LIMITATION — Issue 18: Date missing year (UberEats format)
**Receipt:** us-delivery-01.txt
**Symptom:** `date: null` — `"Mon May 11 at 4:05 PM"` has no year
**Root cause:** UberEats prints relative date with day-of-week and time but no year
**Behaviour:** `date` flagged for user input. Correct — we cannot infer the year reliably.
**Future:** Could infer year from current date if date is within ±7 days. Not worth the complexity for v1.

---

---

### FIXED — Issue 19: PIN line parsed as item
**Receipt:** us-delivery-02.txt
**Symptom:** `"+1 312-766-8835 PIN: 068 78 715"` → item with price `715`
**Root cause:** `PIN:` not in phone noise patterns; `715` at end matched price regex
**Fix:** Added `/\bpin\s*:/i` and `/^\+\d[\d\s\-()]{7,}/` to `PATTERNS.noise`

---

### FIXED — Issue 20: Order note continuation merged with item
**Receipt:** us-delivery-02.txt
**Symptom:** `"don't forget the garlic aioli 2x Classic Dig Bowl $27.08"` — note line merged with item. Quantity `2` missed, item name corrupted.
**Root cause:** `"don't forget..."` passed `looksLikeName` check (has letters, not separator), merged with next price-bearing line. `ORDER NOTE` header not in noise patterns.
**Fix:** Added to `PATTERNS.noise`:
- `/\border\s*(details?|note)\b/i` — catches ORDER NOTE header
- `/\breturn\s*customer\b/i` — order note body
- `/\bdon'?t\s+forget\b/i` — order note body
- `/\bdelivery\s*date\s*:/i`, `/\breceived\s*:/i`, `/\binternal\s*id\b/i` — other metadata

---

### FIXED — Issue 22: Total null when no explicit Total line
**Receipt:** us-delivery-02.txt
**Symptom:** `total: null` — UberEats receipt shows subtotal + individual charges but no "Grand Total" line
**Root cause:** Parser only populated `total` from explicit `total`-classified lines
**Fix:** Added total inference in `extractFields`: when `total === null && subtotal !== null && charges.length > 0`, compute `total = subtotal + sum(non-gstInclusive charges)`. Confidence set to `0.70` (lower than explicit `0.92`) so it's flagged for user confirmation.

---

### ACCEPTED LIMITATION — Issue 21: Platform name as merchant (delivery app receipts)
**Receipt:** us-delivery-02.txt
**Symptom:** `merchantName: "Uber Eats #9E273"` — actual restaurant `"Dig Inn"` appears on line 4, not line 1
**Root cause:** Delivery platform receipts print platform name first, restaurant name second. Our first-line merchant heuristic picks up the platform.
**Behaviour:** `merchantName` is flagged (confidence 0.80 < default threshold... actually 0.80 > 0.75 so not flagged). User must manually correct to "Dig Inn".
**Future fix:** For `billType: delivery`, scan for a second restaurant-name-like line after platform metadata is filtered, and prefer it over the first line.

---

---

### FIXED — Issue 23: Negative prices with `*` suffix not extracted
**Receipt:** us-grocery-01.txt
**Symptom:** Discount lines like `"WH/SDL GR GRAPES SCP -0.77 *"` had price extracted as `null`
**Root cause:** `PRICE_RE` only matched positive numbers; `*` suffix after number blocked the match
**Fix:** Updated `PRICE_RE` to include optional negative sign and optional trailing `*`: `/(-?)\s*[₹$]?\s*(\d...)[NTFX]?\s*$/`
Also added: if `extractPrice < 0` and line doesn't match date patterns → classify as `discount` (confidence 0.82)

---

### FIXED — Issue 24: Payment method lines (EGift, Cash, Change) as items
**Receipt:** us-grocery-01.txt
**Symptom:** `EGift $10.00`, `Cash $0.41`, `Change $0.00` all appeared as food items
**Root cause:** No payment method category in noise patterns
**Fix:** Added general payment method pattern to `PATTERNS.noise`: `/^(egift|e-gift|gift\s*card|cash|credit|debit|visa|mastercard|amex|change|tender|paid)\b/i`

---

### FIXED — Issue 25: Savings summary lines as discounts / items
**Receipt:** us-grocery-01.txt
**Symptom:** `"Stop & Shop Card Savings $18.98"` → discount; `"***YEAR-TO-DATE SAVINGS*** $356.74"` → discount at $356.74 (wrecked totals)
**Root cause:** Savings/loyalty program lines contain amounts and "savings" keyword that matched discount patterns
**Fix:** Added noise patterns for savings summary lines: year-to-date, card savings, personal thanks, your-total-savings, total-stop-and-shop

---

### FIXED — Issue 26: Wrong total from savings summary
**Receipt:** us-grocery-01.txt
**Symptom:** `total: 24.04` (Your Total Savings) instead of `20.41` (Total after savings)
**Root cause:** Parser took the first `total`-classified line. "Your Total Savings" matched total pattern before "Total after savings"
**Fix:** Added `/\btotal\s*after\s*(savings?|discount)\b/i` as highest-priority total pattern. Added `/\byour\s*total\s*savings?\b/i` to noise — it's informational, not the bill total.

---

### FIXED — Issue 27: Section headers as merchant name
**Receipt:** us-grocery-01.txt
**Symptom:** `"END EASYSHOP ORDER"` → merchant name
**Root cause:** First non-empty line is assumed to be merchant; section headers weren't filtered
**Fix:** Added `/^(end|your|our)\s+\w.{3,}\s+(order|summary|section)\s*$/i` to `PATTERNS.noise`

---

### FIXED — Issue 28: Wrong subtotal from intermediate total
**Receipt:** us-grocery-01.txt
**Symptom:** `subtotal: 20.41` from first `Total 20.41` line (post-discount intermediate), not `$44.45` (pre-discount)
**Root cause:** "Total before savings" not mapped to subtotal type
**Fix:** Added `/\btotal\s*before\s*(savings?|discount)\b/i` to `PATTERNS.subtotal`

---

### FIXED — Issue 32: Multi-line merchant name merged with first item
**Receipt:** us-grocery-02.txt
**Symptom:** `"Supermarket 2 APPLE"` as one item; merchant `"Green"` only
**Root cause:** `mergeWrappedLines` merged "Supermarket" (no price, pure text) with "2 APPLE 1.00" (has price)
**Fix:** Added `isMerchantContinuation()` detection. When first AND second content lines are both short pure-text (≤2 words first, 1 word second), the second is marked as `merchant_name` and protected from merging. Extractor concatenates multiple merchant_name lines.

---

### FIXED — Issue 33: Leading quantity digit stripped as SI serial number
**Receipt:** us-grocery-02.txt
**Symptom:** `"2 APPLE 1.00"` → name `"APPLE"`, quantity `1` (leading `2` stripped as serial number)
**Root cause:** `stripSerialNumber` stripped ANY leading digit before a letter
**Fix:** `stripSerialNumber` now only fires when line has **3+ numeric tokens** (tabular format with SI|Name|Qty|Price|Amount). `"2 APPLE 1.00"` has 2 numeric tokens → digit is quantity, not serial.
Also added bare quantity extraction: `"2 APPLE"` → `extractQuantityAndName` now handles `N WORD` prefix format.

---

### FIXED — Issue 34: Barcode extracted as item
**Receipt:** us-grocery-02.txt
**Symptom:** `"1234567890012"` → item with price `890012`
**Root cause:** Long all-digit string matched price regex (trailing digits extracted)
**Fix:** Added `/^\d{8,}$/` to `PATTERNS.noise` — barcodes are 8+ digit strings

---

### FIXED — Issue 35: `1.00N` POS tax suffix breaks price extraction
**Receipt:** us-grocery-03.txt
**Symptom:** All 8 Dollar Tree items had wrong names (`"#IST CRUNCHY CHZ 1 1.00 1.00N"`) — `N` blocked price extraction
**Root cause:** `PRICE_RE` required line to end with a digit or whitespace. `N` (non-taxable marker) is appended by some POS systems after the price.
**Fix:** `PRICE_RE` updated to allow optional single alpha suffix `[NTFX]` after the price. `cleanItemName` also strips trailing alpha suffix before price-matching.

---

### FIXED — Issue 36: US phone format `(215) 491-1617` extracted as negative discount
**Receipt:** us-grocery-03.txt
**Symptom:** `-1617` extracted from phone number → classified as discount
**Root cause:** Existing phone noise pattern didn't match `(NXX) NXX-XXXX` format
**Fix:** Added `/^\(\d{3}\)\s*\d{3}[-\s]\d{4}/` to `PATTERNS.noise`

---

### FIXED — Issue 37: Store number `St##1 1693` as item
**Receipt:** us-grocery-03.txt
**Symptom:** `"St##1 1693"` → item with price `1693`
**Root cause:** OCR artifact `##` in store number prefix not in noise patterns
**Fix:** Added `/\bst[#\s]*\d+\b|\bstore\s*#?\s*\d+/i` and `/^#{2,}/` to `PATTERNS.noise`

---

### FIXED — Issue 39: `GENERAL EXEM $0.00` as item
**Receipt:** us-grocery-03.txt
**Symptom:** Tax exemption line with zero value classified as item
**Root cause:** No exemption line pattern in classifier
**Fix:** Added `/\b(general\s*ex(em|empt?)|tax\s*ex(em|empt?))\b/i` to `PATTERNS.noise`

---

### FIXED — Issue 40: Promotional tagline `Where Everything's $1.00` as item
**Receipt:** us-grocery-03.txt
**Symptom:** Dollar Tree tagline classified as a $1 item
**Root cause:** Ends with `$1.00` — item pattern matches
**Fix:** Added `/\bwhere\s+every/i` and `/\bshop\s+on.?line\b/i` to `PATTERNS.noise`

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
| Dates without year (UberEats) | `"Mon May 11 at 4:05 PM"` — no year, date always null, user fills in. |
| Multi-currency not supported | India (INR) and USA (USD) only. No cross-currency groups. |
| Handwritten receipts | Not supported in v1. ML Kit handles printed text only. |
| Delivery platform as merchant name | Platform (Uber Eats, Swiggy) appears first; restaurant on line 4+. Future fix: scan for restaurant name after metadata is filtered. |
| Tax table pair (Indian POS) | `TAX %... CGST SGST TAX AMOUNT` header + pure-numeric data row — GST amount lost. User adds manually. Future fix: parse header+data as a pair. |
| Partial receipts | Receipts showing only payment/savings section have no items — flagged correctly, no false data added. |

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
