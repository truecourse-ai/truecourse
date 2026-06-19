CREATE TABLE "gh_baselines" (
	"repo_full_name" text PRIMARY KEY NOT NULL,
	"commit_sha" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gh_inferred_actions" (
	"repo_full_name" text NOT NULL,
	"kind" text NOT NULL,
	"identity" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gh_inferred_actions_repo_full_name_kind_identity_pk" PRIMARY KEY("repo_full_name","kind","identity")
);
--> statement-breakpoint
CREATE TABLE "gh_installations" (
	"installation_id" bigint PRIMARY KEY NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"workspace_org_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gh_repos" (
	"repo_full_name" text PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"workspace_org_id" text NOT NULL,
	"default_branch" text NOT NULL,
	"blocking" boolean DEFAULT true NOT NULL,
	"code_quality_blocking" boolean DEFAULT true NOT NULL,
	"code_quality_min_severity" text DEFAULT 'high' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notify_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"notifications" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gh_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_full_name" text NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"base_sha" text,
	"conclusion" text NOT NULL,
	"added_count" integer NOT NULL,
	"resolved_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_provider_config" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"fallback_model" text,
	"api_key_enc" text,
	"access_key_id" text,
	"base_url" text,
	"region" text,
	"headers" jsonb,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content" (
	"scope" text NOT NULL,
	"sha" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "content_scope_sha_pk" PRIMARY KEY("scope","sha")
);
--> statement-breakpoint
CREATE TABLE "verify_snapshots" (
	"repo_key" text NOT NULL,
	"commit_sha" text NOT NULL,
	"branch" text,
	"snapshot" jsonb NOT NULL,
	"drift_count" integer NOT NULL,
	"by_severity" jsonb NOT NULL,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "verify_snapshots_repo_key_commit_sha_pk" PRIMARY KEY("repo_key","commit_sha")
);
--> statement-breakpoint
CREATE TABLE "analyses" (
	"repo_key" text NOT NULL,
	"filename" text NOT NULL,
	"analysis_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "analyses_repo_key_filename_pk" PRIMARY KEY("repo_key","filename")
);
--> statement-breakpoint
CREATE TABLE "analysis_current" (
	"repo_key" text NOT NULL,
	"kind" text NOT NULL,
	"body" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "analysis_current_repo_key_kind_pk" PRIMARY KEY("repo_key","kind")
);
--> statement-breakpoint
CREATE TABLE "analysis_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"repo_key" text NOT NULL,
	"analysis_id" text NOT NULL,
	"entry" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"scope" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"last_opened" text,
	"last_analyzed" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "repo_config" (
	"repo_key" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_ui_state" (
	"repo_key" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_sets" (
	"repo_key" text NOT NULL,
	"commit_sha" text NOT NULL,
	"kind" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"file_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contract_sets_repo_key_commit_sha_kind_pk" PRIMARY KEY("repo_key","commit_sha","kind")
);
--> statement-breakpoint
CREATE TABLE "spec_sets" (
	"repo_key" text NOT NULL,
	"commit_sha" text NOT NULL,
	"artifact" text NOT NULL,
	"content_sha" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spec_sets_repo_key_commit_sha_artifact_pk" PRIMARY KEY("repo_key","commit_sha","artifact")
);
--> statement-breakpoint
CREATE TABLE "extraction_cache" (
	"cache_name" text NOT NULL,
	"cache_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "extraction_cache_cache_name_cache_key_pk" PRIMARY KEY("cache_name","cache_key")
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"workspace_org_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"external_id" text NOT NULL,
	"doc_path" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"version" text,
	"content_hash" text NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "knowledge_documents_workspace_org_id_source_kind_external_id_pk" PRIMARY KEY("workspace_org_id","source_kind","external_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_contract_sets" (
	"workspace_org_id" text NOT NULL,
	"kind" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"file_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_contract_sets_workspace_org_id_kind_pk" PRIMARY KEY("workspace_org_id","kind")
);
--> statement-breakpoint
CREATE TABLE "workspace_spec_sets" (
	"workspace_org_id" text NOT NULL,
	"artifact" text NOT NULL,
	"content_sha" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_spec_sets_workspace_org_id_artifact_pk" PRIMARY KEY("workspace_org_id","artifact")
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"workspace_org_id" text NOT NULL,
	"provider" text NOT NULL,
	"config" jsonb NOT NULL,
	"token_enc" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "integration_connections_workspace_org_id_provider_pk" PRIMARY KEY("workspace_org_id","provider")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_org_id" text NOT NULL,
	"type" text NOT NULL,
	"key" text,
	"status" text NOT NULL,
	"progress_current" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"progress_message" text,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_org_id" text NOT NULL,
	"kind" text NOT NULL,
	"level" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
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
	"prompt_sha" text NOT NULL,
	"output_sha" text,
	"reasoning_sha" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"workspace_org_id" text PRIMARY KEY NOT NULL,
	"code_analysis_llm" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gh_runs_repo_created_idx" ON "gh_runs" USING btree ("repo_full_name","created_at");--> statement-breakpoint
CREATE INDEX "verify_snapshots_repo_verified_idx" ON "verify_snapshots" USING btree ("repo_key","verified_at");--> statement-breakpoint
CREATE INDEX "verify_snapshots_baseline_idx" ON "verify_snapshots" USING btree ("repo_key","is_baseline","verified_at");--> statement-breakpoint
CREATE INDEX "analyses_repo_analysis_idx" ON "analyses" USING btree ("repo_key","analysis_id");--> statement-breakpoint
CREATE INDEX "analysis_history_repo_idx" ON "analysis_history" USING btree ("repo_key","id");--> statement-breakpoint
CREATE INDEX "contract_sets_repo_kind_created_idx" ON "contract_sets" USING btree ("repo_key","kind","created_at");--> statement-breakpoint
CREATE INDEX "contract_sets_repo_kind_hash_idx" ON "contract_sets" USING btree ("repo_key","kind","manifest_hash");--> statement-breakpoint
CREATE INDEX "spec_sets_repo_artifact_created_idx" ON "spec_sets" USING btree ("repo_key","artifact","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_documents_org_idx" ON "knowledge_documents" USING btree ("workspace_org_id");--> statement-breakpoint
CREATE INDEX "integration_connections_org_idx" ON "integration_connections" USING btree ("workspace_org_id");--> statement-breakpoint
CREATE INDEX "jobs_org_idx" ON "jobs" USING btree ("workspace_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_key_uniq" ON "jobs" USING btree ("workspace_org_id","key") WHERE status in ('queued','running');--> statement-breakpoint
CREATE INDEX "notifications_org_created_idx" ON "notifications" USING btree ("workspace_org_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_traces_org_created_idx" ON "llm_traces" USING btree ("workspace_org_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_traces_trace_idx" ON "llm_traces" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "llm_traces_org_stage_idx" ON "llm_traces" USING btree ("workspace_org_id","stage");--> statement-breakpoint
CREATE INDEX "llm_traces_org_prompt_idx" ON "llm_traces" USING btree ("workspace_org_id","prompt_hash");