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

    const accounts = await sql.query<{ provider: string; account_id: string; account_login: string; workspace_org_id: string | null }>(
      'SELECT provider, account_id, account_login, workspace_org_id FROM provider_accounts ORDER BY account_id',
    );
    expect(accounts.rows).toEqual([
      { provider: 'github', account_id: '111', account_login: 'acme', workspace_org_id: 'org_A' },
      { provider: 'github', account_id: '222', account_login: 'beta', workspace_org_id: null },
    ]);
    const repos = await sql.query<{ repo_full_name: string; provider: string; account_id: string; workspace_org_id: string; default_branch: string; location: string | null }>(
      'SELECT repo_full_name, provider, account_id, workspace_org_id, default_branch, location FROM repositories ORDER BY repo_full_name',
    );
    expect(repos.rows).toEqual([
      { repo_full_name: 'acme/api', provider: 'github', account_id: '111', workspace_org_id: 'org_A', default_branch: 'dev', location: null },
      { repo_full_name: 'acme/ui', provider: 'github', account_id: '111', workspace_org_id: 'org_A', default_branch: 'master', location: null },
    ]);
  });
});

describe('0021_drop_ee_era', () => {
  it('keeps every document connection, with its token, and clears the cached sweep delta', async () => {
    const { sql, finish } = await databaseBefore('0021_drop_ee_era');
    await sql.query(
      `INSERT INTO integration_connections (workspace_org_id, provider, config, token_enc, pending, created_at, updated_at)
       VALUES ('org_A', 'jira', '{"baseUrl":"https://acme.atlassian.net"}', 'enc-jira', '{"delta":{"new":3}}', $1, $1),
              ('org_A', 'confluence', '{"spaceKey":"ENG"}', 'enc-confluence', NULL, $1, $1)`,
      [NOW],
    );

    await finish();

    const rows = await sql.query<{ provider: string; config: Record<string, string>; token_enc: string; pending: unknown }>(
      'SELECT provider, config, token_enc, pending FROM integration_connections ORDER BY provider',
    );
    expect(rows.rows).toEqual([
      { provider: 'confluence', config: { spaceKey: 'ENG' }, token_enc: 'enc-confluence', pending: null },
      { provider: 'jira', config: { baseUrl: 'https://acme.atlassian.net' }, token_enc: 'enc-jira', pending: null },
    ]);
  });
});
