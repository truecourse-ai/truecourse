CREATE TABLE "guard_setup_sets" (
	"repo_key" text NOT NULL,
	"commit_sha" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"file_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guard_setup_sets_repo_key_commit_sha_pk" PRIMARY KEY("repo_key","commit_sha")
);
