CREATE TABLE "registry" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"last_opened" text,
	"last_analyzed" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "repo_config" (
	"repo_key" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_ui_state" (
	"repo_key" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL
);
