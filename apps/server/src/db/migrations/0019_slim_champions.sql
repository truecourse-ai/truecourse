ALTER TABLE "repos" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "repos" CASCADE;--> statement-breakpoint
ALTER TABLE "analyses" DROP COLUMN "repo_id";--> statement-breakpoint
ALTER TABLE "violations" DROP COLUMN "repo_id";
