import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
  LlmConfigStore,
  type LlmDb,
} from '../../ee/packages/server/src/llm/store';
import { schema, MIGRATIONS_DIR } from '@truecourse/ee-db';

const SECRET = 'master-secret-at-least-32-chars-long!!';

let client: PGlite;
let store: LlmConfigStore;

beforeEach(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  store = new LlmConfigStore(db as unknown as LlmDb, SECRET, () => client.close());
});

afterEach(async () => {
  await store.close();
});

describe('LlmConfigStore (Drizzle, validated against pglite)', () => {
  it('returns null when unconfigured', async () => {
    expect(await store.getView()).toBeNull();
    expect(await store.getProviderConfig()).toBeNull();
  });

  it('round-trips an anthropic config; the view masks the key, the config decrypts it', async () => {
    await store.save({ provider: 'anthropic', model: 'claude-x', apiKey: 'sk-ant-secret' });

    const view = await store.getView();
    expect(view?.provider).toBe('anthropic');
    expect(view?.model).toBe('claude-x');
    expect(view?.hasKey).toBe(true);
    expect(view?.keyMask).toBe('••••cret');
    // The raw key must never appear in the view.
    expect(JSON.stringify(view)).not.toContain('sk-ant-secret');

    const cfg = await store.getProviderConfig();
    expect(cfg?.apiKey).toBe('sk-ant-secret');
  });

  it('preserves the stored key when an update omits it (same provider)', async () => {
    await store.save({ provider: 'anthropic', model: 'claude-x', apiKey: 'sk-keep' });
    await store.save({ provider: 'anthropic', model: 'claude-y' }); // no apiKey
    const cfg = await store.getProviderConfig();
    expect(cfg?.model).toBe('claude-y');
    expect(cfg?.apiKey).toBe('sk-keep');
  });

  it('clears the stored key when switching provider without a new key', async () => {
    await store.save({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-openai' });
    // Switch to Bedrock (ambient IAM), no secret entered — must NOT inherit the OpenAI key.
    await store.save({ provider: 'bedrock', model: 'anthropic.claude', region: 'us-east-1' });
    const cfg = await store.getProviderConfig();
    expect(cfg?.provider).toBe('bedrock');
    expect(cfg?.secretAccessKey).toBeUndefined();
    const view = await store.getView();
    expect(view?.hasKey).toBe(false);
  });

  it('maps bedrock fields — secret encrypted, access key id plaintext, region kept', async () => {
    await store.save({
      provider: 'bedrock',
      model: 'anthropic.claude',
      region: 'us-east-1',
      accessKeyId: 'AKIA123',
      apiKey: 'aws-secret-1234',
    });
    const cfg = await store.getProviderConfig();
    expect(cfg?.provider).toBe('bedrock');
    expect(cfg?.region).toBe('us-east-1');
    expect(cfg?.accessKeyId).toBe('AKIA123');
    expect(cfg?.secretAccessKey).toBe('aws-secret-1234');
    expect(cfg?.apiKey).toBeUndefined();

    const view = await store.getView();
    expect(view?.keyMask).toBe('••••1234');
    expect(JSON.stringify(view)).not.toContain('aws-secret');
  });
});
