CREATE TABLE "extraction_cache" (
	"cache_name" text NOT NULL,
	"cache_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "extraction_cache_cache_name_cache_key_pk" PRIMARY KEY("cache_name","cache_key")
);
