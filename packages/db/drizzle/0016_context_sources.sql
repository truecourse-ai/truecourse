CREATE TABLE "context_bindings" (
	"workspace_org_id" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"source_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "context_bindings_workspace_org_id_repo_full_name_source_id_pk" PRIMARY KEY("workspace_org_id","repo_full_name","source_id")
);
--> statement-breakpoint
CREATE TABLE "context_documents" (
	"workspace_org_id" text NOT NULL,
	"source_id" text NOT NULL,
	"doc_id" text NOT NULL,
	"doc_path" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "context_documents_workspace_org_id_source_id_doc_id_pk" PRIMARY KEY("workspace_org_id","source_id","doc_id")
);
--> statement-breakpoint
CREATE TABLE "context_sources" (
	"workspace_org_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text NOT NULL,
	"status_note" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "context_sources_workspace_org_id_id_pk" PRIMARY KEY("workspace_org_id","id")
);
--> statement-breakpoint
CREATE TABLE "context_syncs" (
	"workspace_org_id" text NOT NULL,
	"source_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"parent_at" timestamp with time zone,
	"added" integer NOT NULL,
	"changed" integer NOT NULL,
	"removed" integer NOT NULL,
	"unchanged" integer NOT NULL,
	CONSTRAINT "context_syncs_workspace_org_id_source_id_at_pk" PRIMARY KEY("workspace_org_id","source_id","at")
);
--> statement-breakpoint
CREATE INDEX "context_bindings_org_source_idx" ON "context_bindings" USING btree ("workspace_org_id","source_id");--> statement-breakpoint
CREATE INDEX "context_documents_org_idx" ON "context_documents" USING btree ("workspace_org_id");--> statement-breakpoint
CREATE INDEX "context_documents_path_idx" ON "context_documents" USING btree ("workspace_org_id","source_id","doc_path");--> statement-breakpoint
CREATE INDEX "context_sources_org_kind_idx" ON "context_sources" USING btree ("workspace_org_id","kind");--> statement-breakpoint
CREATE INDEX "context_syncs_org_at_idx" ON "context_syncs" USING btree ("workspace_org_id","at");