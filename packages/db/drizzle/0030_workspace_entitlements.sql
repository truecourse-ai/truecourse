CREATE TABLE "workspace_entitlements" (
	"workspace_org_id" text NOT NULL,
	"feature" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"granted_by" text,
	"note" text,
	CONSTRAINT "workspace_entitlements_workspace_org_id_feature_pk" PRIMARY KEY("workspace_org_id","feature")
);
--> statement-breakpoint
CREATE INDEX "workspace_entitlements_org_idx" ON "workspace_entitlements" USING btree ("workspace_org_id");