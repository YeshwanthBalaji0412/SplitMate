# Seed Data for Demo

Instructions for populating the SplitMate database with enough data to
make the demo and analytics screens look populated and realistic.

---

## Prerequisites

- Supabase project running with migrations 001–006 applied
- Two test accounts signed up (Account A + Account B)
- At least one group with both accounts as members

If you don't have this yet, sign up via the app, create a group, and
have the second account join via invite code.

---

## Option 1: Seed via the app (recommended)

Walk through the app UI to create real data. This exercises the full
stack and catches any integration issues before the demo.

### Step 1: Create 5 bills in the demo group

Use Account A (the presenter account). All bills paid by A.

| # | Title | Type | Items | Charges |
|---|---|---|---|---|
| 1 | Friday Dinner | Restaurant | Salmon $24, Salad $14, Beer $8 | Tax $3.68, Tip $9.00 |
| 2 | Grocery Run | Grocery | Milk $4.49, Bread $5.99, Wine $12.99 | Tax $1.88 |
| 3 | Zomato Order | Delivery | Paneer Masala $16.99, Naan $3.49 | Delivery $3.99, Tax $1.64 |
| 4 | Uber Eats | Delivery | Pizza $18.00, Wings $12.00 | Delivery $4.99, Platform fee $2.50, Tax $2.40 |
| 5 | Coffee Run | Restaurant | Latte $5.50, Cappuccino $5.50 | Tax $0.88 |

For each bill:
1. Add Bill → fill title, type, items, charges
2. Save → Assign items (split each item between both members)
3. Confirm assignments → verify owed amounts on bill detail

### Step 2: Settle 3 of the 5 bills

Switch to Account B:
1. Settle Up → see 5 transfers
2. Mark 3 of them as paid (leaving 2 unsettled for the demo)

This gives you:
- 5 bills (3 settled, 2 active) — enough for the personality card
- Settlement streak of 3 (if settled in order)
- Category breakdown: 2 restaurant, 2 delivery, 1 grocery
- Active transfers visible on the Settle Up screen

### Step 3: Verify analytics

Account A → Dashboard → "📊 My Report":
- Total spent should be non-zero
- Category breakdown should show restaurant + delivery + grocery bars
- Settlement streak should show 3
- Personality card should appear (5+ bills)

Account A → Group home → "Group Stats":
- Group total should match sum of all 5 bills
- Your share vs average should show a delta

---

## Option 2: Seed via SQL (faster, less realistic)

Run these in Supabase SQL Editor. Replace the UUIDs with your actual
user IDs and group ID.

```sql
-- Get your user IDs and group ID
SELECT id, email FROM profiles;
SELECT id, name FROM groups;
```

Then use the IDs in the inserts below. Replace `<GROUP_ID>`, `<USER_A>`,
`<USER_B>` with real UUIDs.

```sql
-- Bill 1: Friday Dinner
INSERT INTO expenses (group_id, title, total_amount, currency, category, bill_type, input_source, paid_by, date, status, split_method, created_by)
VALUES ('<GROUP_ID>', 'Friday Dinner', 58.68, 'USD', 'food', 'restaurant', 'manual', '<USER_A>', '2026-05-20', 'active', 'itemized', '<USER_A>')
RETURNING id;
-- Use the returned ID as <EXP1_ID>

INSERT INTO line_items (expense_id, name, quantity, unit_price, total_price, position)
VALUES
  ('<EXP1_ID>', 'Grilled Salmon', 1, 24.00, 24.00, 0),
  ('<EXP1_ID>', 'Caesar Salad', 1, 14.00, 14.00, 1),
  ('<EXP1_ID>', 'IPA Beer', 1, 8.00, 8.00, 2);

INSERT INTO charge_components (expense_id, type, label, amount, allocation_rule, position)
VALUES
  ('<EXP1_ID>', 'tax', 'Sales Tax', 3.68, 'proportional_subtotal', 0),
  ('<EXP1_ID>', 'tip', 'Tip', 9.00, 'proportional_subtotal', 1);

INSERT INTO expense_participants (expense_id, user_id, is_included, owed_amount, paid_amount)
VALUES
  ('<EXP1_ID>', '<USER_A>', true, 39.12, 58.68),
  ('<EXP1_ID>', '<USER_B>', true, 19.56, 0);
```

Repeat similar patterns for bills 2–5. Then insert settlements:

```sql
-- Settle bill 1
INSERT INTO settlements (group_id, from_user_id, to_user_id, amount, currency, status, settled_at)
VALUES ('<GROUP_ID>', '<USER_B>', '<USER_A>', 19.56, 'USD', 'completed', NOW())
RETURNING id;
-- Use returned ID as <SETTLE_ID>

INSERT INTO settlement_expense_links (settlement_id, expense_id, amount_from_expense)
VALUES ('<SETTLE_ID>', '<EXP1_ID>', 19.56);

-- Flip expense to settled
UPDATE expenses SET status = 'settled' WHERE id = '<EXP1_ID>';
```

---

## Verification queries

After seeding, run these to confirm the data looks right:

```sql
-- Bill count per group
SELECT g.name, COUNT(e.id) AS bills, SUM(e.total_amount) AS total
FROM groups g
LEFT JOIN expenses e ON e.group_id = g.id
GROUP BY g.id, g.name;

-- Settlement count
SELECT COUNT(*) AS settlements, SUM(amount) AS total_settled
FROM settlements WHERE group_id = '<GROUP_ID>';

-- Participant owed amounts (should be non-zero for assigned bills)
SELECT e.title, p.display_name, ep.owed_amount
FROM expense_participants ep
JOIN profiles p ON p.id = ep.user_id
JOIN expenses e ON e.id = ep.expense_id
ORDER BY e.created_at DESC, ep.owed_amount DESC
LIMIT 20;
```

---

## Minimum data for each screen

| Screen | Minimum data needed |
|---|---|
| Dashboard | 1+ group |
| Group home | 1+ member |
| Bill entry | Group with 2+ members |
| Assign items | 1 bill with items |
| Bill detail | 1 bill with assigned items (owed_amount > 0) |
| Settle Up | 1 unsettled bill with owed_amounts |
| My Report | 1+ bill where user is a participant |
| Group Stats | 1+ bill in the group this month |
| Personality card | 5+ bills where user is a participant |
| Settlement streak | 1+ bill settled within 48h of creation |
