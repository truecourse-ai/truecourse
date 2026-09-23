CREATE TABLE IF NOT EXISTS "integration_connections" (
	"workspace_org_id" text NOT NULL,
	"provider" text NOT NULL,
	"config" jsonb NOT NULL,
	"token_enc" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "integration_connections_workspace_org_id_provider_pk" PRIMARY KEY("workspace_org_id","provider")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_connections_org_idx" ON "integration_connections" USING btree ("workspace_org_id");--> statement-breakpoint
ALTER TABLE "integration_connections" DROP COLUMN IF EXISTS "pending";
