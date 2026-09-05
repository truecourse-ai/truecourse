CREATE TABLE "spec_sources" (
	"repo_key" text PRIMARY KEY NOT NULL,
	"registry" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
