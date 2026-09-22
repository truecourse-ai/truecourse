/**
 * The migration that turned the one-row-per-repository tables into series:
 * rows that exist before it get an id, a scope and their provenance columns,
 * the default-branch flag becomes the `default` scope, and a row that was
 * never the default branch's lands in a scope of its own rather than shadowing
 * the repository's current state — the scenario set and the setup bundle
 * written at an unflagged report's commit follow that report, since they
 * carried no flag of their own, and every report names the set at its commit.
 */
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyMigration, applyMigrationsBefore } from '../helpers/migrations';

const VERSIONED_STATE = '0030_versioned_state';

describe('the versioned-state migration', () => {
  it('backfills ids, scopes and provenance on the rows already stored', async () => {
    const client = new PGlite();
    try {
      await applyMigrationsBefore(client, VERSIONED_STATE);
      await client.exec(`
        insert into guard_results (repo_key, commit_sha, report, is_baseline, generated_at, created_at, updated_at)
        values ('acme/api', 'main1', '{}', true, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
               ('acme/api', 'head9', '{}', false, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
        insert into guard_runs (repo_key, commit_sha, run_id, snapshot, summary, is_baseline, ran_at, created_at)
        values ('acme/api', 'main1', 'r-main', '{}', '{}', true, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
               ('acme/api', 'head9', 'r-head', '{}', '{}', false, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
        insert into guard_scenario_sets (repo_key, commit_sha, manifest, manifest_hash, file_count, created_at, updated_at)
        values ('acme/api', 'main1', '{"v":1,"files":{}}', 'h', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
               ('acme/api', 'head9', '{"v":1,"files":{}}', 'h', 0, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
               ('acme/api', 'orphan', '{"v":1,"files":{}}', 'h', 0, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z');
        insert into guard_setup_sets (repo_key, commit_sha, manifest, manifest_hash, file_count, created_at, updated_at)
        values ('acme/api', 'main1', '{"v":1,"files":{}}', 'h', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
               ('acme/api', 'head9', '{"v":1,"files":{}}', 'h', 0, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
        insert into workspace_spec_sets (workspace_org_id, artifact, content_sha, created_at, updated_at)
        values ('org_acme', 'corpus', 'sha256-c', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      `);

      await applyMigration(client, VERSIONED_STATE);

      const results = await client.query<{ commit_sha: string; scope: string; id: string; produced_by_run: string | null }>(
        'select commit_sha, scope, id, produced_by_run from guard_results order by commit_sha',
      );
      expect(results.rows.map((r) => [r.commit_sha, r.scope, r.produced_by_run])).toEqual([
        ['head9', 'unflagged', null],
        ['main1', 'default', null],
      ]);
      expect(new Set(results.rows.map((r) => r.id)).size).toBe(2);

      const runs = await client.query<{ run_id: string; scope: string }>(
        'select run_id, scope from guard_runs order by run_id',
      );
      expect(runs.rows).toEqual([
        { run_id: 'r-head', scope: 'unflagged' },
        { run_id: 'r-main', scope: 'default' },
      ]);

      // The set and the bundle at the unflagged report's commit follow it; a
      // set at a commit with no report at all stays on the default line.
      for (const table of ['guard_scenario_sets', 'guard_setup_sets']) {
        const rows = await client.query<{ commit_sha: string; id: string; scope: string; model: string | null }>(
          `select commit_sha, id, scope, model from ${table} order by commit_sha`,
        );
        expect(rows.rows.map((r) => [r.commit_sha, r.scope, r.model])).toEqual([
          ['head9', 'unflagged', null],
          ['main1', 'default', null],
          ...(table === 'guard_scenario_sets' ? [['orphan', 'default', null]] : []),
        ]);
        for (const row of rows.rows) expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      }
      // Every report names the set stored beside it.
      const paired = await client.query<{ commit_sha: string; scenario_set_id: string | null; set_commit: string | null }>(
        `select r.commit_sha, r.scenario_set_id, s.commit_sha as set_commit
           from guard_results r left join guard_scenario_sets s on s.id = r.scenario_set_id
          order by r.commit_sha`,
      );
      expect(paired.rows.map((r) => [r.commit_sha, r.set_commit])).toEqual([
        ['head9', 'head9'],
        ['main1', 'main1'],
      ]);
      const spec = await client.query<{ id: string; scope: string }>('select id, scope from workspace_spec_sets');
      expect(spec.rows).toEqual([{ id: expect.stringMatching(/^[0-9a-f-]{36}$/), scope: 'default' }]);
      // The old flag and the upsert stamp are gone.
      const columns = await client.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'guard_results'",
      );
      const names = columns.rows.map((r) => r.column_name);
      expect(names).not.toContain('is_baseline');
      expect(names).not.toContain('updated_at');
    } finally {
      await client.close();
    }
  });
});
