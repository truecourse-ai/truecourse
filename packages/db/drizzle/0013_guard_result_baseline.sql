-- IF NOT EXISTS: a database that ran this change under its earlier number
-- (before the overlays table took 0012) already has the column.
ALTER TABLE "guard_results" ADD COLUMN IF NOT EXISTS "is_baseline" boolean DEFAULT false NOT NULL;
