CREATE TABLE "User" ("id" SERIAL PRIMARY KEY, "email" TEXT NOT NULL UNIQUE);
CREATE TABLE "Session" ("token" TEXT PRIMARY KEY);
CREATE TABLE "Document" ("id" SERIAL PRIMARY KEY, "tenant" TEXT NOT NULL, "status" TEXT NOT NULL);
-- Reproduce Documenso's schema-qualified migration. This must run unchanged.
INSERT INTO "public"."User" ("email") VALUES ('deleted-account@fixture.test');
