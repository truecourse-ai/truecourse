import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { WorkspaceSettingsStore } from '../../ee/packages/data-store/src/index';

let client: PGlite;
let store: WorkspaceSettingsStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  // Also asserts the 0003_workspace_settings migration applies cleanly.
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  store = new WorkspaceSettingsStore(d as unknown as EeDb);
});
afterEach(async () => {
  await client.close();
});

describe('WorkspaceSettingsStore', () => {
  it('defaults codeAnalysisLlm to false when the workspace has no row', async () => {
    expect(await store.codeAnalysisLlm('org_a')).toBe(false);
    expect(await store.get('org_a')).toEqual({ codeAnalysisLlm: false });
  });

  it('persists the toggle, is idempotent on re-set, and is org-scoped', async () => {
    await store.setCodeAnalysisLlm('org_a', true);
    expect(await store.codeAnalysisLlm('org_a')).toBe(true);
    // a second workspace is unaffected (defaults off)
    expect(await store.codeAnalysisLlm('org_b')).toBe(false);
    // toggling back off updates the same row
    await store.setCodeAnalysisLlm('org_a', false);
    expect(await store.codeAnalysisLlm('org_a')).toBe(false);
  });
});
