/**
 * The migration that lifts a repository source's `owner/repo` out of its
 * config into a column of its own: rows that exist before it are backfilled,
 * a site row stays null, and the unique constraint holds from then on.
 */
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyMigration, applyMigrationsBefore } from '../helpers/migrations';

const REPOSITORY_SOURCES = '0034_repository_sources';

describe('the repository-sources migration', () => {
  it('backfills the repository column from each repository source\'s config', async () => {
    const client = new PGlite();
    try {
      await applyMigrationsBefore(client, REPOSITORY_SOURCES);
      await client.exec(`
        insert into context_sources (workspace_org_id, id, kind, title, config, status, created_at, updated_at)
        values ('org_a', 'repo-acme-api', 'repository', 'acme/api', '{"repoFullName":"acme/api","include":[],"exclude":[],"branch":""}', 'never', now(), now()),
               ('org_a', 'docs', 'site', 'docs', '{"llmsTxtUrl":"https://docs.acme.com/llms.txt"}', 'never', now(), now()),
               ('org_b', 'docs', 'site', 'docs', '{"llmsTxtUrl":"https://docs.acme.com/llms.txt"}', 'never', now(), now());
      `);

      await applyMigration(client, REPOSITORY_SOURCES);

      const rows = await client.query<{ workspace_org_id: string; id: string; repo_full_name: string | null }>(
        'select workspace_org_id, id, repo_full_name from context_sources order by workspace_org_id, id',
      );
      expect(rows.rows).toEqual([
        { workspace_org_id: 'org_a', id: 'docs', repo_full_name: null },
        { workspace_org_id: 'org_a', id: 'repo-acme-api', repo_full_name: 'acme/api' },
        { workspace_org_id: 'org_b', id: 'docs', repo_full_name: null },
      ]);
      await expect(
        client.exec(`
          insert into context_sources (workspace_org_id, id, kind, title, config, repo_full_name, status, created_at, updated_at)
          values ('org_b', 'repo-acme-api', 'repository', 'acme/api', '{}', 'acme/api', 'never', now(), now());
        `),
      ).rejects.toThrow(/context_sources_repo_full_name_unique/);
    } finally {
      await client.close();
    }
  });

  it('stops, naming the repositories, when two workspaces already read one', async () => {
    const client = new PGlite();
    try {
      await applyMigrationsBefore(client, REPOSITORY_SOURCES);
      await client.exec(`
        insert into context_sources (workspace_org_id, id, kind, title, config, status, created_at, updated_at)
        values ('org_a', 'repo-acme-api', 'repository', 'acme/api', '{"repoFullName":"acme/api"}', 'never', now(), now()),
               ('org_b', 'repo-acme-api', 'repository', 'acme/api', '{"repoFullName":"acme/api"}', 'never', now(), now());
      `);
      await expect(applyMigration(client, REPOSITORY_SOURCES)).rejects.toThrow(/read by more than one: acme\/api/);
    } finally {
      await client.close();
    }
  });
});
