CREATE TABLE "pending_baselines" (
	"repo_full_name" text PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"default_branch" text NOT NULL,
	"commit_sha" text NOT NULL,
	"workspace_org_id" text NOT NULL,
	"force" boolean DEFAULT false NOT NULL,
	"quiet" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
