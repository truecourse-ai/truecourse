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
CREATE INDEX "analyses_repo_analysis_idx" ON "analyses" USING btree ("repo_key","analysis_id");--> statement-breakpoint
CREATE INDEX "analysis_history_repo_idx" ON "analysis_history" USING btree ("repo_key","id");