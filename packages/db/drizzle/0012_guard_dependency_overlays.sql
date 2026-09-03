CREATE TABLE "guard_dependency_overlays" (
	"repo_key" text PRIMARY KEY NOT NULL,
	"overlays_enc" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
