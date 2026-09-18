CREATE TABLE "provider_account_links" (
	"provider" text NOT NULL,
	"account_id" text NOT NULL,
	"workspace_org_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "provider_account_links_provider_account_id_workspace_org_id_pk" PRIMARY KEY("provider","account_id","workspace_org_id")
);
--> statement-breakpoint
ALTER TABLE "provider_account_links" ADD CONSTRAINT "provider_account_links_account_fk" FOREIGN KEY ("provider","account_id") REFERENCES "public"."provider_accounts"("provider","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_account_links_workspace_idx" ON "provider_account_links" USING btree ("workspace_org_id");--> statement-breakpoint
INSERT INTO "provider_account_links" ("provider", "account_id", "workspace_org_id", "created_at")
SELECT "provider", "account_id", "workspace_org_id", "updated_at" FROM "provider_accounts" WHERE "workspace_org_id" IS NOT NULL;--> statement-breakpoint
DROP INDEX "provider_accounts_workspace_idx";--> statement-breakpoint
ALTER TABLE "provider_accounts" DROP COLUMN "workspace_org_id";
