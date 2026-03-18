CREATE TABLE "code_violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"line_start" integer NOT NULL,
	"line_end" integer NOT NULL,
	"column_start" integer NOT NULL,
	"column_end" integer NOT NULL,
	"rule_key" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"snippet" text NOT NULL,
	"fix_prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_violations" ADD CONSTRAINT "code_violations_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;