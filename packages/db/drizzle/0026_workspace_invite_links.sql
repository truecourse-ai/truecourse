CREATE TABLE "workspace_invite_links" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_org_id" text NOT NULL,
	"token" text NOT NULL,
	"inviter_user_id" text NOT NULL,
	"inviter_name" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_invite_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE INDEX "workspace_invite_links_org_idx" ON "workspace_invite_links" USING btree ("workspace_org_id");