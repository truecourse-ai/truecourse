import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { schema, MIGRATIONS_DIR, llmTraces, type EeDb } from '@truecourse/ee-db';
import type { LlmTraceInput } from '@truecourse/shared';
import { FsBlobStore } from '../../ee/packages/storage/src/index';
import { PgBlobTraceStore, keys } from '../../ee/packages/data-store/src/index';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

/** A complete trace input; override only what a case cares about. */
function mkInput(over: Partial<LlmTraceInput> = {}): LlmTraceInput {
  return {
    workspaceOrgId: 'org_1',
    traceId: 'trace_1',
    parentId: null,
    stage: 'contract.extract',
    callId: 'contract.extract:s1',
    sliceId: 's1',
    module: null,
    topic: null,
    model: 'primary-model',
    status: 'ok',
    errorMessage: null,
    finishReason: 'stop',
    usedFallback: false,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    reasoningTokens: null,
    latencyMs: 42,
    system: 'SYS',
    user: 'USER',
    output: 'OUT',
    reasoning: null,
    metadata: { provider: 'anthropic' },
    ...over,
  };
}

describe('PgBlobTraceStore (pglite + fs blob)', () => {
  let client: PGlite;
  let blobDir: string;
  let blob: FsBlobStore;
  let db: EeDb;
  let store: PgBlobTraceStore;

  beforeEach(async () => {
    client = new PGlite();
    blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-blob-'));
    blob = new FsBlobStore(blobDir);
    db = await makeDb(client);
    store = new PgBlobTraceStore(db, blob);
  });
  afterEach(async () => {
    await client.close();
    fs.rmSync(blobDir, { recursive: true, force: true });
  });

  it('round-trips: record → list → get with hydrated payloads', async () => {
    await store.record(mkInput());

    const list = await store.list({ org: 'org_1' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      stage: 'contract.extract',
      sliceId: 's1',
      model: 'primary-model',
      status: 'ok',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      usedFallback: false,
    });
    expect(list[0]!.promptHash).toMatch(/^sha256-/);

    const detail = await store.get(list[0]!.id, 'org_1');
    expect(detail).not.toBeNull();
    expect(detail!.system).toBe('SYS');
    expect(detail!.user).toBe('USER');
    expect(detail!.output).toBe('OUT');
    expect(detail!.metadata).toMatchObject({ provider: 'anthropic' });
  });

  it('groups identical prompts: one prompt object, N rows (the divergence view)', async () => {
    await store.record(mkInput({ callId: 'c:1', output: 'A' }));
    await store.record(mkInput({ callId: 'c:2', output: 'B' }));

    const list = await store.list({ org: 'org_1' });
    expect(list).toHaveLength(2);
    expect(list[0]!.promptHash).toBe(list[1]!.promptHash);

    const byHash = await store.listByPromptHash(list[0]!.promptHash, { org: 'org_1' });
    expect(byHash).toHaveLength(2);

    // identical prompt → one stored object; two distinct outputs → two more.
    const objs = await blob.list(keys.traceObjectPrefix('org_1'));
    expect(objs.length).toBe(3);

    const outputs = (await Promise.all(byHash.map((s) => store.get(s.id, 'org_1')))).map(
      (d) => d!.output,
    );
    expect(outputs.sort()).toEqual(['A', 'B']);
  });

  it('records an error trace with no output', async () => {
    await store.record(
      mkInput({
        status: 'error',
        errorMessage: 'boom',
        output: null,
        finishReason: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      }),
    );
    const [s] = await store.list({ org: 'org_1' });
    expect(s!.status).toBe('error');
    const d = await store.get(s!.id, 'org_1');
    expect(d!.output).toBeNull();
    expect(d!.errorMessage).toBe('boom');
  });

  it('isolates orgs', async () => {
    await store.record(mkInput({ workspaceOrgId: 'org_1' }));
    await store.record(mkInput({ workspaceOrgId: 'org_2' }));
    expect(await store.list({ org: 'org_1' })).toHaveLength(1);
    expect(await store.list({ org: 'org_2' })).toHaveLength(1);
    expect(await store.list({ org: 'org_3' })).toHaveLength(0);
  });

  it('lists across all orgs when no org filter (operator), + listOrgs + cross-org stats', async () => {
    await store.record(mkInput({ workspaceOrgId: 'org_1', callId: 'a:1' }));
    await store.record(mkInput({ workspaceOrgId: 'org_2', callId: 'b:1' }));
    expect(await store.list()).toHaveLength(2); // no org filter → cross-org
    expect(await store.list({ org: 'org_1' })).toHaveLength(1);
    expect((await store.listOrgs())).toEqual(['org_1', 'org_2']);
    expect((await store.stats()).totalCalls).toBe(2);
  });

  it('filters list by stage and status', async () => {
    await store.record(mkInput({ callId: 'a:1', stage: 'contract.extract', status: 'ok' }));
    await store.record(mkInput({ callId: 'b:1', stage: 'spec.claimExtract', status: 'ok' }));
    await store.record(mkInput({ callId: 'c:1', stage: 'contract.extract', status: 'error', output: null }));
    expect(await store.list({ org: 'org_1', stage: 'contract.extract' })).toHaveLength(2);
    expect(await store.list({ org: 'org_1', status: 'error' })).toHaveLength(1);
    expect(await store.list({ org: 'org_1', stage: 'spec.claimExtract', status: 'ok' })).toHaveLength(1);
  });

  it('aggregates per-stage stats', async () => {
    await store.record(mkInput({ callId: 'a:1', totalTokens: 10 }));
    await store.record(mkInput({ callId: 'a:2', totalTokens: 20 }));
    await store.record(mkInput({ callId: 'a:3', status: 'error', output: null, totalTokens: null }));

    const stats = await store.stats({ org: 'org_1' });
    expect(stats.totalCalls).toBe(3);
    expect(stats.totalErrors).toBe(1);
    const stage = stats.stages.find((s) => s.stage === 'contract.extract')!;
    expect(stage.calls).toBe(3);
    expect(stage.errors).toBe(1);
    expect(stage.totalTokens).toBe(30);
  });

  it('gc prunes rows older than the cutoff and sweeps orphaned objects', async () => {
    await store.record(mkInput({ callId: 'a:1', system: 'SYS-A', user: 'U-A', output: 'OUT-A' }));
    await store.record(mkInput({ callId: 'b:1', system: 'SYS-B', user: 'U-B', output: 'OUT-B' }));
    expect((await blob.list(keys.traceObjectPrefix('org_1'))).length).toBe(4);

    // Age the first call into the past, then collect anything older than 30 days.
    await db
      .update(llmTraces)
      .set({ createdAt: '2020-01-01T00:00:00.000Z' })
      .where(eq(llmTraces.callId, 'a:1'));

    const res = await store.gc({ org: 'org_1', olderThanDays: 30 });
    expect(res.deletedRows).toBe(1);
    expect(res.deletedObjects).toBe(2); // the aged row's prompt + output

    const list = await store.list({ org: 'org_1' });
    expect(list).toHaveLength(1);
    expect(list[0]!.callId).toBe('b:1');
    expect((await blob.list(keys.traceObjectPrefix('org_1'))).length).toBe(2);
  });
});
