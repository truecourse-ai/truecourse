CREATE TABLE "gh_inferred_actions" (
	"repo_full_name" text NOT NULL,
	"kind" text NOT NULL,
	"identity" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gh_inferred_actions_repo_full_name_kind_identity_pk" PRIMARY KEY("repo_full_name","kind","identity")
);
