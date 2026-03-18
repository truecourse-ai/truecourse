ALTER TABLE "diff_checks" RENAME COLUMN "resolved_insight_ids" TO "resolved_violation_ids";--> statement-breakpoint
ALTER TABLE "diff_checks" RENAME COLUMN "new_insights" TO "new_violations";