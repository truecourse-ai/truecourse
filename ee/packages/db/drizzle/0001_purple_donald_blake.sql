CREATE TABLE "workspace_contract_sets" (
	"workspace_org_id" text NOT NULL,
	"kind" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"file_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_contract_sets_workspace_org_id_kind_pk" PRIMARY KEY("workspace_org_id","kind")
);
