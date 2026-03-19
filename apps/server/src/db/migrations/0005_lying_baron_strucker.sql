CREATE TABLE "flow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"source_service" text NOT NULL,
	"source_module" text NOT NULL,
	"source_method" text NOT NULL,
	"target_service" text NOT NULL,
	"target_module" text NOT NULL,
	"target_method" text NOT NULL,
	"step_type" text NOT NULL,
	"data_description" text,
	"is_async" boolean DEFAULT false NOT NULL,
	"is_conditional" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"entry_service" text NOT NULL,
	"entry_method" text NOT NULL,
	"category" text NOT NULL,
	"trigger" text NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flow_steps" ADD CONSTRAINT "flow_steps_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;