CREATE TABLE "guard_backfill_markers" (
	"repo_full_name" text PRIMARY KEY NOT NULL,
	"marked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_guard_baselines" (
	"repo_full_name" text PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"default_branch" text NOT NULL,
	"commit_sha" text NOT NULL,
	"workspace_org_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
