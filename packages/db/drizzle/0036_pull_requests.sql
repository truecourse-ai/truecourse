CREATE TABLE "pull_request_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_full_name" text NOT NULL,
	"number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"attempt" integer NOT NULL,
	"merge_base_sha" text,
	"base_commit_sha" text,
	"status" text NOT NULL,
	"conclusion" text,
	"reason" text,
	"job_id" text,
	"guard_run_id" text,
	"github_check_run_id" bigint,
	"report" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "pull_request_checks_attempt_unique" UNIQUE("repo_full_name","number","head_sha","attempt")
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"repo_full_name" text NOT NULL,
	"number" integer NOT NULL,
	"workspace_org_id" text NOT NULL,
	"provider" text NOT NULL,
	"title" text NOT NULL,
	"author_login" text NOT NULL,
	"head_sha" text NOT NULL,
	"head_ref" text NOT NULL,
	"base_ref" text NOT NULL,
	"head_repo_full_name" text,
	"draft" boolean NOT NULL,
	"state" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pull_requests_repo_full_name_number_pk" PRIMARY KEY("repo_full_name","number")
);
--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "permissions" jsonb;--> statement-breakpoint
CREATE INDEX "pull_request_checks_pr_idx" ON "pull_request_checks" USING btree ("repo_full_name","number","created_at");--> statement-breakpoint
CREATE INDEX "pull_requests_workspace_idx" ON "pull_requests" USING btree ("workspace_org_id","state","updated_at");