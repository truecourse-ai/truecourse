CREATE TABLE "gh_baselines" (
	"repo_full_name" text PRIMARY KEY NOT NULL,
	"commit_sha" text NOT NULL,
	"drifts" jsonb,
	"captured_at" timestamp with time zone NOT NULL
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
	"enabled" boolean DEFAULT true NOT NULL,
	"notify_emails" text[] DEFAULT '{}'::text[] NOT NULL,
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
CREATE INDEX "gh_runs_repo_created_idx" ON "gh_runs" USING btree ("repo_full_name","created_at");