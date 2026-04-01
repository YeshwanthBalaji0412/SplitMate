-- Development seed — creates test users and a sample group with an expense.
-- Only run against local Supabase (supabase db reset --local).
-- DO NOT run in production.

-- Test users are created via Supabase auth.users (handled by the dashboard or CLI).
-- This seed assumes user UUIDs:
--   user-yesh  = '00000000-0000-0000-0000-000000000001'
--   user-bob   = '00000000-0000-0000-0000-000000000002'
--   user-carol = '00000000-0000-0000-0000-000000000003'
--
-- In local dev, create them via: supabase auth admin create-user <email>

-- Sample group
INSERT INTO groups (id, name, type, currency, created_by, invite_code)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'Tokyo Trip 2026',
  'trip',
  'USD',
  '00000000-0000-0000-0000-000000000001',
  'tokyoXX'
) ON CONFLICT DO NOTHING;

-- Members
INSERT INTO group_members (group_id, user_id, role) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'member'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'member')
ON CONFLICT DO NOTHING;

-- Sample expense: dinner with itemized bill
INSERT INTO expenses (id, group_id, title, total_amount, currency, category, paid_by, split_method, created_by)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Sushi dinner',
  55.00,
  'USD',
  'food',
  '00000000-0000-0000-0000-000000000001',
  'itemized',
  '00000000-0000-0000-0000-000000000001'
) ON CONFLICT DO NOTHING;

-- Line items
INSERT INTO line_items (id, expense_id, name, quantity, unit_price, total_price, position) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Salmon Sashimi', 1, 30.00, 30.00, 0),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Tuna Roll',      1, 20.00, 20.00, 1)
ON CONFLICT DO NOTHING;

-- Yesh consumed Salmon, Bob consumed Tuna
INSERT INTO line_item_participants (line_item_id, user_id, shares) VALUES
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 1),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 1)
ON CONFLICT DO NOTHING;

-- Charge components: sales tax ($5) split proportionally
INSERT INTO charge_components (expense_id, type, label, amount, rate, allocation_rule, position) VALUES
  ('20000000-0000-0000-0000-000000000001', 'sales_tax', 'Sales Tax (10%)', 5.00, 0.10, 'proportional_to_subtotal', 1)
ON CONFLICT DO NOTHING;
