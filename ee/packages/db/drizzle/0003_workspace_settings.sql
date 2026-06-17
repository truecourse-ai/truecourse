CREATE TABLE "workspace_settings" (
	"workspace_org_id" text PRIMARY KEY NOT NULL,
	"code_analysis_llm" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
