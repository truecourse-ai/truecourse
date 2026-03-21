CREATE TABLE "deterministic_violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" text NOT NULL,
	"service_name" text NOT NULL,
	"module_name" text,
	"method_name" text,
	"file_path" text,
	"related_module_name" text,
	"related_service_name" text,
	"is_dependency_violation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diff_checks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "layer_dependencies" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "diff_checks" CASCADE;--> statement-breakpoint
DROP TABLE "layer_dependencies" CASCADE;--> statement-breakpoint
ALTER TABLE "code_violations" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "code_violations" ADD COLUMN "first_seen_analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "code_violations" ADD COLUMN "first_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "code_violations" ADD COLUMN "previous_code_violation_id" uuid;--> statement-breakpoint
ALTER TABLE "code_violations" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "is_dependency_violation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "deterministic_violation_id" uuid;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "first_seen_analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "first_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "previous_violation_id" uuid;--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deterministic_violations" ADD CONSTRAINT "deterministic_violations_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_violations" ADD CONSTRAINT "code_violations_first_seen_analysis_id_analyses_id_fk" FOREIGN KEY ("first_seen_analysis_id") REFERENCES "public"."analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_deterministic_violation_id_deterministic_violations_id_fk" FOREIGN KEY ("deterministic_violation_id") REFERENCES "public"."deterministic_violations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_first_seen_analysis_id_analyses_id_fk" FOREIGN KEY ("first_seen_analysis_id") REFERENCES "public"."analyses"("id") ON DELETE set null ON UPDATE no action;