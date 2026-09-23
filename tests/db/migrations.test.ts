/**
 * The migrations that reshape production's tables must carry the rows across:
 * a connected repository and the App installation behind it are the workspace's
 * connection registry, and every per-repo guard table is reachable only through
 * them. Each case applies the chain up to the migration under test, seeds what
 * production holds, applies the rest, and reads the rows back.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_DIR } from '@truecourse/db';

interface JournalEntry {
  idx: number;
  tag: string;
}

const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as {
  entries: JournalEntry[];
};

const tempDirs: string[] = [];
let client: PGlite | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A copy of the migrations folder whose journal stops just before `tag`. */
function migrationsBefore(tag: string): string {
  const stop = journal.entries.findIndex((e) => e.tag === tag);
  if (stop < 0) throw new Error(`no migration tagged ${tag}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-migrations-'));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'meta'));
  for (const entry of journal.entries.slice(0, stop)) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), path.join(dir, `${entry.tag}.sql`));
  }
  fs.writeFileSync(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, stop) }),
  );
  return dir;
}

async function databaseBefore(tag: string) {
  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: migrationsBefore(tag) });
  return {
    sql: client,
    finish: async () => migrate(db, { migrationsFolder: MIGRATIONS_DIR }),
  };
}

const NOW = '2026-09-15T09:40:00Z';

describe('0027_provider_account_links', () => {
  it('moves each installation’s workspace onto a link row, and an unattached one gets none', async () => {
    const { sql, finish } = await databaseBefore('0027_provider_account_links');
    await sql.query(
      `INSERT INTO provider_accounts (provider, account_id, account_login, account_type, workspace_org_id, created_at, updated_at)
       VALUES ('github', '111', 'acme', 'Organization', 'org_A', $1, $1), ('github', '222', 'beta', 'User', NULL, $1, $1)`,
      [NOW],
    );

    await finish();

    const links = await sql.query<{ provider: string; account_id: string; workspace_org_id: string }>(
      'SELECT provider, account_id, workspace_org_id FROM provider_account_links',
    );
    expect(links.rows).toEqual([{ provider: 'github', account_id: '111', workspace_org_id: 'org_A' }]);
    // The account row no longer carries a workspace at all.
    const columns = await sql.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'provider_accounts'",
    );
    expect(columns.rows.map((c) => c.column_name)).not.toContain('workspace_org_id');
    // Dropping the account drops its link.
    await sql.query("DELETE FROM provider_accounts WHERE account_id = '111'");
    expect((await sql.query('SELECT 1 FROM provider_account_links')).rows).toEqual([]);
  });
});

describe('0022_provider_repositories', () => {
  it('renames the connection registry in place, keeping every repository and installation', async () => {
    const { sql, finish } = await databaseBefore('0022_provider_repositories');
    await sql.query(
      `INSERT INTO gh_installations (installation_id, account_login, account_type, workspace_org_id, created_at, updated_at)
       VALUES (111, 'acme', 'Organization', 'org_A', $1, $1), (222, 'beta', 'User', NULL, $1, $1)`,
      [NOW],
    );
    await sql.query(
      `INSERT INTO gh_repos (repo_full_name, installation_id, workspace_org_id, default_branch, created_at, updated_at)
       VALUES ('acme/api', 111, 'org_A', 'dev', $1, $1), ('acme/ui', 111, 'org_A', 'master', $1, $1)`,
      [NOW],
    );

    await finish();

    const accounts = await sql.query<{ provider: string; account_id: string; account_login: string }>(
      'SELECT provider, account_id, account_login FROM provider_accounts ORDER BY account_id',
    );
    expect(accounts.rows).toEqual([
      { provider: 'github', account_id: '111', account_login: 'acme' },
      { provider: 'github', account_id: '222', account_login: 'beta' },
    ]);
    // The workspace an installation belonged to rides on as its link (0027).
    const links = await sql.query<{ account_id: string; workspace_org_id: string }>(
      'SELECT account_id, workspace_org_id FROM provider_account_links ORDER BY account_id',
    );
    expect(links.rows).toEqual([{ account_id: '111', workspace_org_id: 'org_A' }]);
    const repos = await sql.query<{ repo_full_name: string; provider: string; account_id: string; workspace_org_id: string; default_branch: string; location: string | null }>(
      'SELECT repo_full_name, provider, account_id, workspace_org_id, default_branch, location FROM repositories ORDER BY repo_full_name',
    );
    expect(repos.rows).toEqual([
      { repo_full_name: 'acme/api', provider: 'github', account_id: '111', workspace_org_id: 'org_A', default_branch: 'dev', location: null },
      { repo_full_name: 'acme/ui', provider: 'github', account_id: '111', workspace_org_id: 'org_A', default_branch: 'master', location: null },
    ]);
  });

  it('mints each repository its slug within its workspace, oldest connection first on a collision', async () => {
    const { sql, finish } = await databaseBefore('0022_provider_repositories');
    await sql.query(
      `INSERT INTO gh_repos (repo_full_name, installation_id, workspace_org_id, default_branch, created_at, updated_at)
       VALUES ('acme/data-pipeline', 1, 'org_A', 'main', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
              ('acme/data_pipeline', 1, 'org_A', 'main', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
              ('acme/data-pipeline-2', 2, 'org_B', 'main', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z')`,
    );

    await finish();

    const rows = await sql.query<{ repo_full_name: string; slug: string }>(
      'SELECT repo_full_name, slug FROM repositories ORDER BY workspace_org_id, created_at',
    );
    expect(rows.rows).toEqual([
      { repo_full_name: 'acme/data-pipeline', slug: 'acme-data-pipeline' },
      { repo_full_name: 'acme/data_pipeline', slug: 'acme-data-pipeline-2' },
      { repo_full_name: 'acme/data-pipeline-2', slug: 'acme-data-pipeline-2' },
    ]);
  });
});

describe('0021_drop_ee_era', () => {
  it('keeps every document connection with its token; the cached sweep delta is cleared, then dropped by 0031', async () => {
    const { sql, finish } = await databaseBefore('0021_drop_ee_era');
    await sql.query(
      `INSERT INTO integration_connections (workspace_org_id, provider, config, token_enc, pending, created_at, updated_at)
       VALUES ('org_A', 'jira', '{"baseUrl":"https://acme.atlassian.net"}', 'enc-jira', '{"delta":{"new":3}}', $1, $1),
              ('org_A', 'confluence', '{"spaceKey":"ENG"}', 'enc-confluence', NULL, $1, $1)`,
      [NOW],
    );

    await finish();

    const rows = await sql.query<{ provider: string; config: Record<string, string>; token_enc: string }>(
      'SELECT provider, config, token_enc FROM integration_connections ORDER BY provider',
    );
    expect(rows.rows).toEqual([
      { provider: 'confluence', config: { spaceKey: 'ENG' }, token_enc: 'enc-confluence' },
      { provider: 'jira', config: { baseUrl: 'https://acme.atlassian.net' }, token_enc: 'enc-jira' },
    ]);
    // 0021 nulled the column; 0031_integration_connections removed it.
    const columns = await sql.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'integration_connections' ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((r) => r.column_name)).toEqual([
      'workspace_org_id',
      'provider',
      'config',
      'token_enc',
      'created_at',
      'updated_at',
    ]);
  });
});

describe('0020_drop_analyze_era', () => {
  it('sweeps the content bodies of the tables it drops and leaves every other scope', async () => {
    const { sql, finish } = await databaseBefore('0020_drop_analyze_era');
    const scopes = [
      'trace:org_A',
      'knowledge:ws',
      'contract:acme/api',
      'contract:ws',
      'guard:acme/api',
      'guard-evidence:acme/api',
      'spec:ws:org_A',
      'context:ws',
    ];
    for (const [i, scope] of scopes.entries()) {
      await sql.query('INSERT INTO content (scope, sha, body, created_at) VALUES ($1, $2, $3, $4)', [scope, `sha${i}`, 'x', NOW]);
    }

    await finish();

    const kept = await sql.query<{ scope: string }>('SELECT scope FROM content ORDER BY scope');
    expect(kept.rows.map((r) => r.scope)).toEqual(['context:ws', 'guard-evidence:acme/api', 'guard:acme/api', 'spec:ws:org_A']);
  });
});

describe('0023_drop_pull_request_gate', () => {
  it("deletes a repository's own spec decisions and every PR overlay, keeping the workspace and guard ledgers", async () => {
    const { sql, finish } = await databaseBefore('0023_drop_pull_request_gate');
    const scopes = ['ws:org_A', 'guard:acme/api', 'acme/api', 'local/my-folder', 'acme/api#pr/4', 'guard:acme/api#pr/5'];
    for (const scope of scopes) {
      await sql.query('INSERT INTO decisions (scope, payload, updated_at) VALUES ($1, $2, $3)', [scope, '{}', NOW]);
    }

    await finish();

    const kept = await sql.query<{ scope: string }>('SELECT scope FROM decisions ORDER BY scope');
    expect(kept.rows.map((r) => r.scope)).toEqual(['guard:acme/api', 'ws:org_A']);
  });
});
