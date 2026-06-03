CREATE TABLE "blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"content_type" text,
	"updated_at" timestamp with time zone NOT NULL
);
