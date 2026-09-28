ALTER TABLE "context_sources" ADD COLUMN "repo_full_name" text;--> statement-breakpoint
UPDATE "context_sources" SET "repo_full_name" = NULLIF("config"->>'repoFullName', '') WHERE "kind" = 'repository';--> statement-breakpoint
DO $$
DECLARE
  duplicated text;
BEGIN
  -- A repository read by two workspaces is a decision, not a rule to apply:
  -- which workspace keeps it is nobody's to guess in a migration. Stop the
  -- boot naming the repositories, so an operator settles it and migrates again.
  SELECT string_agg(repo_full_name, ', ' ORDER BY repo_full_name)
    INTO duplicated
    FROM (SELECT repo_full_name FROM context_sources WHERE repo_full_name IS NOT NULL GROUP BY repo_full_name HAVING count(*) > 1) AS d;
  IF duplicated IS NOT NULL THEN
    RAISE EXCEPTION 'a repository may be one workspace''s context source only; these are read by more than one: %. Remove the extra sources, then start again.', duplicated;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "context_sources" ADD CONSTRAINT "context_sources_repo_full_name_unique" UNIQUE("repo_full_name");