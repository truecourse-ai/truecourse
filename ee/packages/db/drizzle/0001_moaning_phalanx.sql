CREATE TABLE "gh_prs" (
	"repo_full_name" text NOT NULL,
	"pr_number" integer NOT NULL,
	"title" text,
	"state" text NOT NULL,
	"head_sha" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gh_prs_repo_full_name_pr_number_pk" PRIMARY KEY("repo_full_name","pr_number")
);
