ALTER TABLE "guard_runs" RENAME COLUMN "sections" TO "claims";--> statement-breakpoint
UPDATE "guard_runs" SET "claims" = NULL;
