CREATE TABLE "guard_results" (
	"repo_key" text NOT NULL,
	"commit_sha" text NOT NULL,
	"report" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guard_results_repo_key_commit_sha_pk" PRIMARY KEY("repo_key","commit_sha")
);
--> statement-breakpoint
CREATE TABLE "guard_runs" (
	"repo_key" text NOT NULL,
	"commit_sha" text NOT NULL,
	"branch" text,
	"run_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"ran_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guard_runs_repo_key_commit_sha_pk" PRIMARY KEY("repo_key","commit_sha")
);
--> statement-breakpoint
CREATE TABLE "guard_scenario_sets" (
	"repo_key" text NOT NULL,
	"commit_sha" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"file_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guard_scenario_sets_repo_key_commit_sha_pk" PRIMARY KEY("repo_key","commit_sha")
);
--> statement-breakpoint
CREATE INDEX "guard_runs_repo_ran_idx" ON "guard_runs" USING btree ("repo_key","ran_at");--> statement-breakpoint
CREATE INDEX "guard_runs_baseline_idx" ON "guard_runs" USING btree ("repo_key","is_baseline","ran_at");--> statement-breakpoint
CREATE INDEX "guard_runs_repo_run_idx" ON "guard_runs" USING btree ("repo_key","run_id");