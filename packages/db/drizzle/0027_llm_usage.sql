CREATE TABLE "llm_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_org_id" text NOT NULL,
	"repo_full_name" text,
	"job_type" text NOT NULL,
	"job_id" text NOT NULL,
	"run_id" text,
	"subject_kind" text NOT NULL,
	"subject" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_create_tokens" bigint DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "llm_usage_subject_uniq" ON "llm_usage" USING btree ("job_id","subject_kind","subject");--> statement-breakpoint
CREATE INDEX "llm_usage_org_started_idx" ON "llm_usage" USING btree ("workspace_org_id","started_at");