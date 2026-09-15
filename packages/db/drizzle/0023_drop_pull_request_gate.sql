DROP TABLE "gh_baselines" CASCADE;--> statement-breakpoint
DROP TABLE "gh_runs" CASCADE;--> statement-breakpoint
DROP TABLE "gh_prs" CASCADE;--> statement-breakpoint
DROP TABLE "spec_sets" CASCADE;--> statement-breakpoint
DROP TABLE "pending_guard_baselines" CASCADE;--> statement-breakpoint
DELETE FROM "content" WHERE "scope" LIKE 'spec:%' AND "scope" NOT LIKE 'spec:ws:%';--> statement-breakpoint
DELETE FROM "decisions" WHERE "scope" LIKE '%#pr/%';--> statement-breakpoint
DELETE FROM "decisions" WHERE "scope" ~ '^[^:#/]+/[^:#]+$';
