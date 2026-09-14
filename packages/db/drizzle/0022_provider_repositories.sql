DROP TABLE "gh_installations" CASCADE;--> statement-breakpoint
DROP TABLE "gh_repos" CASCADE;--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"provider" text NOT NULL,
	"account_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"workspace_org_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "provider_accounts_provider_account_id_pk" PRIMARY KEY("provider","account_id")
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"repo_full_name" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"account_id" text,
	"workspace_org_id" text NOT NULL,
	"default_branch" text,
	"location" text,
	"blocking" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notify_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"notifications" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "provider_accounts_workspace_idx" ON "provider_accounts" USING btree ("workspace_org_id");--> statement-breakpoint
CREATE INDEX "repositories_workspace_idx" ON "repositories" USING btree ("workspace_org_id");--> statement-breakpoint
CREATE INDEX "repositories_account_idx" ON "repositories" USING btree ("provider","account_id");
