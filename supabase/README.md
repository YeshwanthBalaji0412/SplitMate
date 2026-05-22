# Supabase Migrations

Schema migrations for the SplitMate database. Apply these in order against
your Supabase project. There is no automated runner wired up yet — copy the
SQL into the Supabase Dashboard SQL Editor and execute.

## Run Order

Always apply in numeric order:

1. `migrations/001_initial_schema.sql` — base tables, RLS, triggers, auth profile trigger
2. `migrations/002_swe_schema_fixes.sql` — country / settlement_mode / bill_type / input_source columns, `settlement_expense_links`, `bill_rule_templates`, `receipt_assets.parse_metadata`
3. `migrations/003_schema_fixes.sql` — `expenses.settled_at` + trigger, `line_items.category` + constraint

All three migrations are idempotent (use `IF NOT EXISTS` and `DROP CONSTRAINT IF EXISTS` pairs) so re-running them on a partially-applied schema is safe.

## How to apply (Supabase Dashboard)

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) and select the SplitMate project.
2. Left sidebar → **SQL Editor** → **New query**.
3. Open `migrations/001_initial_schema.sql` in your editor, copy the entire contents, paste into the SQL Editor, click **Run**.
4. Wait for "Success. No rows returned." Then repeat for `002` and `003`.

After all three have run, run the verification queries below in the same SQL Editor.

## Verification queries

Paste each block into the SQL Editor; each one should return the expected rows.

**1. All twelve public tables exist:**

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```
Expected (12 rows):
```
bill_rule_templates
charge_components
expense_participants
expenses
group_members
groups
line_item_participants
line_items
profiles
receipt_assets
settlement_expense_links
settlements
```

**2. RLS is enabled on every public table:**

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```
Expected: `rowsecurity = true` for all 12 rows.

**3. Triggers present:**

```sql
SELECT trigger_name, event_object_schema, event_object_table
FROM information_schema.triggers
WHERE trigger_schema IN ('public', 'auth')
ORDER BY event_object_table, trigger_name;
```
Expected to include:
- `on_auth_user_created` on `auth.users` — creates profile on signup
- `trg_expenses_settled_at` on `expenses` — stamps `settled_at` on transition to `'settled'`
- `trg_*_updated_at` on every table with an `updated_at` column

**4. settled_at column is nullable with default NULL:**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'expenses'
  AND column_name IN ('settled_at', 'bill_type', 'input_source', 'status');
```
Expected:
- `settled_at` — `timestamp with time zone`, nullable `YES`, default `NULL`
- `bill_type` — `text`, nullable `NO`, default `'custom'::text`
- `input_source` — `text`, nullable `NO`, default `'manual'::text`
- `status` — `text`, nullable `NO`, default `'active'::text`

**5. line_items.category constraint:**

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'chk_line_items_category';
```
Expected:
```
CHECK ((category = ANY (ARRAY['food'::text, 'alcohol'::text, 'non_taxable'::text, 'other'::text])))
```

**6. One-shot health check (single query, returns one row):**

```sql
WITH t AS (
  SELECT COUNT(*) AS total FROM pg_tables WHERE schemaname = 'public'
),
r AS (
  SELECT COUNT(*) AS with_rls FROM pg_tables
  WHERE schemaname = 'public' AND rowsecurity
)
SELECT t.total AS total_tables, r.with_rls AS rls_enabled,
       (t.total = 12 AND r.with_rls = 12) AS schema_healthy
FROM t, r;
```
Expected: `total_tables=12, rls_enabled=12, schema_healthy=true`

## Resetting (dev only — destroys all data)

If you need to start over during development:

```sql
-- Drop everything in public; auth.users is preserved.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO authenticated, service_role;
```

Then drop the auth trigger and any leftover auth users:
```sql
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- And, from Dashboard → Authentication → Users, delete test users manually.
```

Then re-run 001 → 002 → 003.
