CREATE TABLE "credit_balances" (
	"workspace_org_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"last_grant_credits" integer DEFAULT 0 NOT NULL,
	"last_grant_at" timestamp with time zone,
	"low_notified_at" timestamp with time zone,
	"empty_notified_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_org_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"actor_user_id" text,
	"note" text,
	"usage_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pause_reason" text;--> statement-breakpoint
CREATE INDEX "credit_ledger_org_created_idx" ON "credit_ledger" USING btree ("workspace_org_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_usage_idx" ON "credit_ledger" USING btree ("usage_id");