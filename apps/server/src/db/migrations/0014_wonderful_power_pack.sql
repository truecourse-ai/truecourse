ALTER TABLE "code_violations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deterministic_violations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "code_violations" CASCADE;--> statement-breakpoint
DROP TABLE "deterministic_violations" CASCADE;--> statement-breakpoint
ALTER TABLE "violations" DROP CONSTRAINT IF EXISTS "violations_deterministic_violation_id_deterministic_violations_id_fk";--> statement-breakpoint
ALTER TABLE "violations" DROP CONSTRAINT IF EXISTS "violations_deterministic_violation_id_deterministic_violations_";--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "related_service_id" uuid;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "related_module_id" uuid;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "file_path" text;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "line_start" integer;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "line_end" integer;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "column_start" integer;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "column_end" integer;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "snippet" text;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_related_service_id_services_id_fk" FOREIGN KEY ("related_service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_related_module_id_modules_id_fk" FOREIGN KEY ("related_module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" DROP COLUMN "is_dependency_violation";--> statement-breakpoint
ALTER TABLE "violations" DROP COLUMN "deterministic_violation_id";