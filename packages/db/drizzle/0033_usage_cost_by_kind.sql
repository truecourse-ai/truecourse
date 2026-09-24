ALTER TABLE "llm_usage" ADD COLUMN "input_cost_usd" numeric(18, 8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD COLUMN "output_cost_usd" numeric(18, 8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD COLUMN "cached_cost_usd" numeric(18, 8) DEFAULT '0' NOT NULL;