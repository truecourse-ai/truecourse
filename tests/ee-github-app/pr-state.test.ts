import { describe, it, expect, beforeEach } from 'vitest';
import {
  upsertPrState,
  prStateFromPayload,
  type PullRequestPayload,
} from '../../ee/packages/github-app/src/index';
import { MemoryGateStore } from '../github-app/memory-store';

let store: MemoryGateStore;

beforeEach(() => {
  store = new MemoryGateStore();
});


function payload(
  action: string,
  over: { merged?: boolean; sha?: string; title?: string } = {},
): PullRequestPayload {
  return {
    action,
    number: 42,
    pull_request: {
      title: over.title ?? 'Add widget',
      head: { sha: over.sha ?? 'headsha', ref: 'feature' },
      base: { sha: 'basesha', ref: 'main' },
      merged: over.merged,
    },
    repository: { full_name: 'acme/api', default_branch: 'main' },
    installation: { id: 5 },
  };
}

async function stateOf(): Promise<string | undefined> {
  const prs = await store.listPrs('acme/api');
  return prs.find((p) => p.prNumber === 42)?.state;
}

describe('PR state from pull_request webhook', () => {
  it('derives state from the action + merged flag', () => {
    expect(prStateFromPayload(payload('opened'))).toBe('open');
    expect(prStateFromPayload(payload('reopened'))).toBe('open');
    expect(prStateFromPayload(payload('synchronize'))).toBe('open');
    expect(prStateFromPayload(payload('closed', { merged: true }))).toBe('merged');
    expect(prStateFromPayload(payload('closed', { merged: false }))).toBe('closed');
    expect(prStateFromPayload(payload('closed'))).toBe('closed');
  });

  it('opened → open (with title + head captured)', async () => {
    await upsertPrState(store, payload('opened', { sha: 'sha1', title: 'My PR' }));
    const prs = await store.listPrs('acme/api');
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ prNumber: 42, state: 'open', title: 'My PR', headSha: 'sha1' });
  });

  it('closed + merged → merged', async () => {
    await upsertPrState(store, payload('opened'));
    await upsertPrState(store, payload('closed', { merged: true }));
    expect(await stateOf()).toBe('merged');
  });

  it('closed (unmerged) → closed', async () => {
    await upsertPrState(store, payload('opened'));
    await upsertPrState(store, payload('closed', { merged: false }));
    expect(await stateOf()).toBe('closed');
  });

  it('reopened → open (after a close)', async () => {
    await upsertPrState(store, payload('closed', { merged: false }));
    expect(await stateOf()).toBe('closed');
    await upsertPrState(store, payload('reopened', { sha: 'sha2' }));
    expect(await stateOf()).toBe('open');
    const prs = await store.listPrs('acme/api');
    expect(prs[0].headSha).toBe('sha2');
  });

  it('synchronize refreshes head + keeps the PR open', async () => {
    await upsertPrState(store, payload('opened', { sha: 'sha1' }));
    await upsertPrState(store, payload('synchronize', { sha: 'sha2' }));
    expect(await stateOf()).toBe('open');
    expect((await store.listPrs('acme/api'))[0].headSha).toBe('sha2');
  });

  it('tolerates a missing title (null)', async () => {
    const p = payload('opened');
    delete p.pull_request.title;
    await upsertPrState(store, p);
    expect((await store.listPrs('acme/api'))[0].title).toBeNull();
  });
});
