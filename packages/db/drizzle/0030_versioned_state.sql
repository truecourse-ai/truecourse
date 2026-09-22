DROP INDEX "guard_runs_baseline_idx";--> statement-breakpoint
DROP INDEX "guard_runs_repo_run_idx";--> statement-breakpoint
ALTER TABLE "workspace_spec_sets" DROP CONSTRAINT "workspace_spec_sets_workspace_org_id_artifact_pk";--> statement-breakpoint
ALTER TABLE "guard_results" DROP CONSTRAINT "guard_results_repo_key_commit_sha_pk";--> statement-breakpoint
ALTER TABLE "guard_runs" DROP CONSTRAINT "guard_runs_repo_key_commit_sha_pk";--> statement-breakpoint
ALTER TABLE "guard_scenario_sets" DROP CONSTRAINT "guard_scenario_sets_repo_key_commit_sha_pk";--> statement-breakpoint
ALTER TABLE "guard_setup_sets" DROP CONSTRAINT "guard_setup_sets_repo_key_commit_sha_pk";--> statement-breakpoint
ALTER TABLE "guard_runs" ADD CONSTRAINT "guard_runs_repo_key_run_id_pk" PRIMARY KEY("repo_key","run_id");--> statement-breakpoint
ALTER TABLE "workspace_spec_sets" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "workspace_spec_sets" SET "id" = gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "workspace_spec_sets" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_spec_sets" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "workspace_spec_sets" ADD COLUMN "scope" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_spec_sets" ADD COLUMN "produced_by_run" text;--> statement-breakpoint
ALTER TABLE "workspace_spec_sets" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "workspace_spec_sets" ADD COLUMN "source_commit" text;--> statement-breakpoint
ALTER TABLE "workspace_spec_sets" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "guard_results" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "guard_results" SET "id" = gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "guard_results" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "guard_results" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "guard_results" ADD COLUMN "scope" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "guard_results" ADD COLUMN "produced_by_run" text;--> statement-breakpoint
ALTER TABLE "guard_results" ADD COLUMN "model" text;--> statement-breakpoint
UPDATE "guard_results" SET "scope" = 'unflagged' WHERE NOT "is_baseline";--> statement-breakpoint
ALTER TABLE "guard_results" DROP COLUMN "is_baseline";--> statement-breakpoint
ALTER TABLE "guard_results" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "guard_runs" ADD COLUMN "scope" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "guard_runs" ADD COLUMN "produced_by_run" text;--> statement-breakpoint
ALTER TABLE "guard_runs" ADD COLUMN "model" text;--> statement-breakpoint
UPDATE "guard_runs" SET "scope" = 'unflagged' WHERE NOT "is_baseline";--> statement-breakpoint
ALTER TABLE "guard_runs" DROP COLUMN "is_baseline";--> statement-breakpoint
ALTER TABLE "guard_scenario_sets" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "guard_scenario_sets" SET "id" = gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "guard_scenario_sets" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "guard_scenario_sets" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "guard_scenario_sets" ADD COLUMN "scope" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "guard_scenario_sets" ADD COLUMN "produced_by_run" text;--> statement-breakpoint
ALTER TABLE "guard_scenario_sets" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "guard_scenario_sets" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "guard_setup_sets" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "guard_setup_sets" SET "id" = gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "guard_setup_sets" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "guard_setup_sets" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "guard_setup_sets" ADD COLUMN "scope" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "guard_setup_sets" ADD COLUMN "produced_by_run" text;--> statement-breakpoint
ALTER TABLE "guard_setup_sets" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "guard_setup_sets" DROP COLUMN "updated_at";--> statement-breakpoint
CREATE INDEX "workspace_spec_sets_scope_idx" ON "workspace_spec_sets" USING btree ("workspace_org_id","scope","artifact","created_at");--> statement-breakpoint
CREATE INDEX "guard_results_scope_idx" ON "guard_results" USING btree ("repo_key","scope","commit_sha","created_at");--> statement-breakpoint
CREATE INDEX "guard_runs_scope_idx" ON "guard_runs" USING btree ("repo_key","scope","commit_sha","ran_at");--> statement-breakpoint
CREATE INDEX "guard_scenario_sets_scope_idx" ON "guard_scenario_sets" USING btree ("repo_key","scope","commit_sha","created_at");--> statement-breakpoint
CREATE INDEX "guard_setup_sets_scope_idx" ON "guard_setup_sets" USING btree ("repo_key","scope","commit_sha","created_at");
