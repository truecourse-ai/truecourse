CREATE TABLE "method_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"source_method_id" uuid NOT NULL,
	"target_method_id" uuid NOT NULL,
	"call_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "method_dependencies" ADD CONSTRAINT "method_dependencies_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "method_dependencies" ADD CONSTRAINT "method_dependencies_source_method_id_methods_id_fk" FOREIGN KEY ("source_method_id") REFERENCES "public"."methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "method_dependencies" ADD CONSTRAINT "method_dependencies_target_method_id_methods_id_fk" FOREIGN KEY ("target_method_id") REFERENCES "public"."methods"("id") ON DELETE cascade ON UPDATE no action;