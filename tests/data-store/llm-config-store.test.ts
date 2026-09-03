/**
 * The workspace-keyed LLM provider store: one row per organization, the secret
 * encrypted at rest, and a view that never carries a key. Driven against a real
 * (PGlite) Postgres so the upsert's keep-the-key rule is the SQL's, not a mock's.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, llmProviderConfig, type Db } from '@truecourse/db';
import { PgLlmConfigStore } from '../../packages/data-store/src/index';
import { decryptSecret, encryptSecret, maskKey } from '../../packages/data-store/src/crypto';

const SECRET = 'master-secret-at-least-32-chars-long!!';
const ORG = 'org_a';
const OTHER = 'org_b';

let client: PGlite;
let db: Db;
let store: PgLlmConfigStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as Db;
  store = new PgLlmConfigStore(db, SECRET);
});

afterEach(async () => {
  await client.close();
});

describe('provider-key crypto', () => {
  it('round-trips through AES-256-GCM and masks to the last four characters', () => {
    const blob = encryptSecret('sk-ant-secret', SECRET);
    expect(blob).not.toContain('sk-ant-secret');
    expect(decryptSecret(blob, SECRET)).toBe('sk-ant-secret');
    expect(maskKey('sk-ant-secret')).toBe('••••cret');
  });

  it('refuses a blob encrypted under a different master secret', () => {
    const blob = encryptSecret('sk-ant-secret', SECRET);
    expect(() => decryptSecret(blob, 'another-master-secret-32-chars-long')).toThrow();
  });
});

describe('PgLlmConfigStore', () => {
  it('reads null for a workspace that has configured nothing', async () => {
    expect(await store.getView(ORG)).toBeNull();
    expect(await store.getConfig(ORG)).toBeNull();
  });

  it('stores the key encrypted; the view masks it and the config decrypts it', async () => {
    await store.save(ORG, { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-ant-secret' });

    const view = await store.getView(ORG);
    expect(view).toMatchObject({ provider: 'anthropic', model: 'claude-x', hasKey: true, keyMask: '••••cret' });
    expect(JSON.stringify(view)).not.toContain('sk-ant-secret');

    // The column itself must not hold the plaintext.
    const [row] = await db.select().from(llmProviderConfig);
    expect(row.apiKeyEnc).not.toContain('sk-ant-secret');

    expect(await store.getConfig(ORG)).toMatchObject({ apiKey: 'sk-ant-secret' });
  });

  it('keeps the stored key when an update omits it on the same provider', async () => {
    await store.save(ORG, { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-keep' });
    await store.save(ORG, { provider: 'anthropic', model: 'claude-y' });

    expect(await store.getConfig(ORG)).toMatchObject({ model: 'claude-y', apiKey: 'sk-keep' });
  });

  it('clears the key when the provider changes without a new one', async () => {
    await store.save(ORG, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-openai' });
    await store.save(ORG, { provider: 'bedrock', model: 'anthropic.claude', region: 'us-east-1' });

    const config = await store.getConfig(ORG);
    expect(config).toMatchObject({ provider: 'bedrock', region: 'us-east-1' });
    expect(config?.secretAccessKey).toBeUndefined();
    expect((await store.getView(ORG))?.hasKey).toBe(false);
  });

  it('maps bedrock fields — secret encrypted, access key id plain, region kept', async () => {
    await store.save(ORG, {
      provider: 'bedrock',
      model: 'anthropic.claude',
      region: 'us-east-1',
      accessKeyId: 'AKIA123',
      apiKey: 'aws-secret-1234',
    });

    const config = await store.getConfig(ORG);
    expect(config).toMatchObject({
      provider: 'bedrock',
      region: 'us-east-1',
      accessKeyId: 'AKIA123',
      secretAccessKey: 'aws-secret-1234',
    });
    expect(config?.apiKey).toBeUndefined();
    expect((await store.getView(ORG))?.keyMask).toBe('••••1234');
  });

  it('keeps workspaces apart — one org’s config is invisible to another', async () => {
    await store.save(ORG, { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-a' });
    await store.save(OTHER, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-b' });

    expect(await store.getConfig(ORG)).toMatchObject({ provider: 'anthropic', apiKey: 'sk-a' });
    expect(await store.getConfig(OTHER)).toMatchObject({ provider: 'openai', apiKey: 'sk-b' });

    // Rewriting one leaves the other exactly as it was.
    await store.save(ORG, { provider: 'anthropic', model: 'claude-z' });
    expect(await store.getConfig(OTHER)).toMatchObject({ model: 'gpt-4o', apiKey: 'sk-b' });
  });

  it('masks rather than crashes when the master secret no longer decrypts the key', async () => {
    await store.save(ORG, { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-rotated' });
    const rotated = new PgLlmConfigStore(db, 'a-completely-different-master-secret!!');

    expect(await rotated.getView(ORG)).toMatchObject({ hasKey: true, keyMask: '••••' });
  });
});
