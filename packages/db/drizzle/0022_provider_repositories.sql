ALTER TABLE "gh_installations" RENAME TO "provider_accounts";--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "account_id" text;--> statement-breakpoint
UPDATE "provider_accounts" SET "provider" = 'github', "account_id" = "installation_id"::text;--> statement-breakpoint
ALTER TABLE "provider_accounts" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_accounts" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_accounts" DROP CONSTRAINT "gh_installations_pkey";--> statement-breakpoint
ALTER TABLE "provider_accounts" DROP COLUMN "installation_id";--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_provider_account_id_pk" PRIMARY KEY("provider","account_id");--> statement-breakpoint
CREATE INDEX "provider_accounts_workspace_idx" ON "provider_accounts" USING btree ("workspace_org_id");--> statement-breakpoint
ALTER TABLE "gh_repos" RENAME TO "repositories";--> statement-breakpoint
ALTER TABLE "repositories" RENAME CONSTRAINT "gh_repos_pkey" TO "repositories_pkey";--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "location" text;--> statement-breakpoint
UPDATE "repositories" SET "provider" = 'github', "account_id" = "installation_id"::text;--> statement-breakpoint
ALTER TABLE "repositories" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ALTER COLUMN "default_branch" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" DROP COLUMN "installation_id";--> statement-breakpoint
ALTER TABLE "repositories" DROP COLUMN "code_quality_blocking";--> statement-breakpoint
ALTER TABLE "repositories" DROP COLUMN "code_quality_min_severity";--> statement-breakpoint
CREATE INDEX "repositories_workspace_idx" ON "repositories" USING btree ("workspace_org_id");--> statement-breakpoint
CREATE INDEX "repositories_account_idx" ON "repositories" USING btree ("provider","account_id");
