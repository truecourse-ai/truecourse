ALTER TABLE "repos" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "repos" CASCADE;--> statement-breakpoint
-- drizzle-kit also emits `ALTER TABLE ... DROP CONSTRAINT` here for the FKs,
-- but `DROP TABLE "repos" CASCADE` has already dropped them. Those lines are
-- removed manually; only the column drops remain.
ALTER TABLE "analyses" DROP COLUMN "repo_id";--> statement-breakpoint
ALTER TABLE "violations" DROP COLUMN "repo_id";