CREATE TABLE "activity_events" (
	"run_id" text NOT NULL,
	"cursor" bigint NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "activity_events_run_id_cursor_pk" PRIMARY KEY("run_id","cursor")
);
--> statement-breakpoint
CREATE TABLE "activity_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"repo_key" text NOT NULL,
	"command" text NOT NULL,
	"record" jsonb NOT NULL,
	"next_cursor" bigint DEFAULT 0 NOT NULL,
	"owner" text,
	"lease_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_run_id_activity_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."activity_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_runs_repo_idx" ON "activity_runs" USING btree ("repo_key");