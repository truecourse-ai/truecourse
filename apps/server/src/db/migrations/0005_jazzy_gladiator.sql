CREATE TABLE "methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"name" text NOT NULL,
	"signature" text NOT NULL,
	"param_count" integer DEFAULT 0 NOT NULL,
	"return_type" text,
	"is_async" boolean DEFAULT false NOT NULL,
	"is_exported" boolean DEFAULT false NOT NULL,
	"line_count" integer,
	"statement_count" integer,
	"max_nesting_depth" integer
);
--> statement-breakpoint
CREATE TABLE "module_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"source_module_id" uuid NOT NULL,
	"target_module_id" uuid NOT NULL,
	"imported_names" jsonb NOT NULL,
	"dependency_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"layer_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"file_path" text NOT NULL,
	"method_count" integer DEFAULT 0 NOT NULL,
	"property_count" integer DEFAULT 0 NOT NULL,
	"import_count" integer DEFAULT 0 NOT NULL,
	"export_count" integer DEFAULT 0 NOT NULL,
	"super_class" text,
	"line_count" integer
);
--> statement-breakpoint
ALTER TABLE "methods" ADD CONSTRAINT "methods_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methods" ADD CONSTRAINT "methods_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_dependencies" ADD CONSTRAINT "module_dependencies_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_dependencies" ADD CONSTRAINT "module_dependencies_source_module_id_modules_id_fk" FOREIGN KEY ("source_module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_dependencies" ADD CONSTRAINT "module_dependencies_target_module_id_modules_id_fk" FOREIGN KEY ("target_module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_layer_id_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;