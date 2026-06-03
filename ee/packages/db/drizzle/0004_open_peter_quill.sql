CREATE TABLE "contract_sets" (
	"repo_key" text NOT NULL,
	"commit_sha" text NOT NULL,
	"kind" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"file_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contract_sets_repo_key_commit_sha_kind_pk" PRIMARY KEY("repo_key","commit_sha","kind")
);
--> statement-breakpoint
CREATE TABLE "spec_sets" (
	"repo_key" text NOT NULL,
	"commit_sha" text NOT NULL,
	"artifact" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spec_sets_repo_key_commit_sha_artifact_pk" PRIMARY KEY("repo_key","commit_sha","artifact")
);
--> statement-breakpoint
CREATE INDEX "contract_sets_repo_kind_created_idx" ON "contract_sets" USING btree ("repo_key","kind","created_at");--> statement-breakpoint
CREATE INDEX "contract_sets_repo_kind_hash_idx" ON "contract_sets" USING btree ("repo_key","kind","manifest_hash");--> statement-breakpoint
CREATE INDEX "spec_sets_repo_artifact_created_idx" ON "spec_sets" USING btree ("repo_key","artifact","created_at");