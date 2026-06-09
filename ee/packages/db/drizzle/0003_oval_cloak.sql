CREATE TABLE "llm_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_org_id" text,
	"trace_id" text,
	"parent_id" text,
	"stage" text,
	"call_id" text,
	"slice_id" text,
	"module" text,
	"topic" text,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"finish_reason" text,
	"used_fallback" boolean DEFAULT false NOT NULL,
	"prompt_hash" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"reasoning_tokens" integer,
	"latency_ms" integer NOT NULL,
	"prompt_blob_key" text NOT NULL,
	"output_blob_key" text,
	"reasoning_blob_key" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "llm_traces_org_created_idx" ON "llm_traces" USING btree ("workspace_org_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_traces_trace_idx" ON "llm_traces" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "llm_traces_org_stage_idx" ON "llm_traces" USING btree ("workspace_org_id","stage");--> statement-breakpoint
CREATE INDEX "llm_traces_org_prompt_idx" ON "llm_traces" USING btree ("workspace_org_id","prompt_hash");