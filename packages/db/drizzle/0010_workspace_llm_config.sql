DELETE FROM "llm_provider_config";--> statement-breakpoint
ALTER TABLE "llm_provider_config" RENAME COLUMN "id" TO "org_id";