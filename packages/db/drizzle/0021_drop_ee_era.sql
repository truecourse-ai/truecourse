DROP TABLE "guard_backfill_markers" CASCADE;--> statement-breakpoint
DROP TABLE "pending_baselines" CASCADE;--> statement-breakpoint
UPDATE "integration_connections" SET "pending" = NULL;
