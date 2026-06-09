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
CREATE INDEX "jobs_org_idx" ON "jobs" USING btree ("workspace_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_key_uniq" ON "jobs" USING btree ("workspace_org_id","key") WHERE status in ('queued','running');--> statement-breakpoint
CREATE INDEX "notifications_org_created_idx" ON "notifications" USING btree ("workspace_org_id","created_at");