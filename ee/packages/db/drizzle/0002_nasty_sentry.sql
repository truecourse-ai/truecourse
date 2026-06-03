CREATE TABLE "analyses" (
	"repo_key" text NOT NULL,
	"filename" text NOT NULL,
	"analysis_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "analyses_repo_key_filename_pk" PRIMARY KEY("repo_key","filename")
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
CREATE TABLE "verify_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"repo_key" text NOT NULL,
	"run_id" text NOT NULL,
	"entry" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verify_runs" (
	"repo_key" text NOT NULL,
	"filename" text NOT NULL,
	"run_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "verify_runs_repo_key_filename_pk" PRIMARY KEY("repo_key","filename")
);
--> statement-breakpoint
CREATE INDEX "analyses_repo_analysis_idx" ON "analyses" USING btree ("repo_key","analysis_id");--> statement-breakpoint
CREATE INDEX "analysis_history_repo_idx" ON "analysis_history" USING btree ("repo_key","id");--> statement-breakpoint
CREATE INDEX "verify_history_repo_idx" ON "verify_history" USING btree ("repo_key","id");--> statement-breakpoint
CREATE INDEX "verify_runs_repo_run_idx" ON "verify_runs" USING btree ("repo_key","run_id");