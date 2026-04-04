ALTER TABLE "analyses" ALTER COLUMN "status" SET DEFAULT 'completed';--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "enabled_categories" jsonb;