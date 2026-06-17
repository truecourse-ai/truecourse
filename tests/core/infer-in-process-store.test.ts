/**
 * `inferInProcess` must compute its coverage from the contract STORE (keyed by
 * `ref`), not the local `repoRoot/.truecourse/contracts` dir.
 *
 * In EE the gate runs infer on an ephemeral clone that has NO committed contracts
 * (they live in the Postgres store). If infer read the clone's empty disk it would
 * see zero authored contracts and re-offer everything already documented — e.g. it
 * would report `CustomerTier` as undocumented even though the spec defines it.
 *
 * This test reproduces that shape with the file store: the authored contracts live
 * under a separate "store repo" (`ref.repoKey`), while the "clone" (`repoRoot`) has
 * only code. The documented enum must be subtracted; an undocumented one must still
 * surface; and a ref whose store has no contracts must fall back to inferring it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inferInProcess } from '../../packages/core/src/commands/spec-in-process';
import { resetContractStore } from '../../packages/core/src/lib/contract-store';

const FIXTURE = path.resolve(__dirname, '../fixtures/sample-js-project-il');
const FIXTURE_CONTRACTS = path.join(FIXTURE, 'reference/contracts');
const FIXTURE_CODE = path.join(FIXTURE, 'code');

let storeRepo: string; // stands in for the EE store (file store keys by repoKey)
let emptyStoreRepo: string; // a ref whose store has no contracts
let clone: string; // the ephemeral clone — code only, no committed contracts

beforeEach(() => {
  resetContractStore(); // ensure the file-backed default is active
  storeRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-infer-store-'));
  emptyStoreRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-infer-empty-'));
  clone = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-infer-clone-'));
  // Store repo: authored contracts under <repoKey>/.truecourse/contracts.
  fs.cpSync(FIXTURE_CONTRACTS, path.join(storeRepo, '.truecourse', 'contracts'), {
    recursive: true,
  });
  // Clone: code only — deliberately NO .truecourse/contracts.
  fs.cpSync(FIXTURE_CODE, path.join(clone, 'code'), { recursive: true });
});

afterEach(() => {
  for (const d of [storeRepo, emptyStoreRepo, clone]) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function identities(summaries: { identity: string }[]): Set<string> {
  return new Set(summaries.map((s) => s.identity));
}

describe('inferInProcess — coverage comes from the store, not the clone disk', () => {
  it('subtracts contracts materialized from the store at `ref`', async () => {
    const { summaries } = await inferInProcess(clone, {
      ref: { repoKey: storeRepo, commitSha: 'head' },
      dryRun: true,
    });
    const ids = identities(summaries);

    // Documented in the store (customers/customer-tier.tc) → must NOT be re-inferred.
    expect(ids.has('CustomerTier')).toBe(false);
    // Genuinely undocumented (lives in reference/contracts/_inferred) → still surfaces.
    expect(ids.has('NotificationChannel')).toBe(true);
  });

  it('falls back to `contractsRef` (baseline) when the head ref stored no contracts', async () => {
    // Warm path: the PR head changed no spec, so the gate stored no authored
    // contracts at the head — `ref` resolves to nothing. `contractsRef` (the
    // baseline) must still cover the documented enum.
    const { summaries } = await inferInProcess(clone, {
      ref: { repoKey: emptyStoreRepo, commitSha: 'head' }, // head: no contracts
      contractsRef: { repoKey: storeRepo, commitSha: 'base' }, // baseline: has them
      dryRun: true,
    });
    const ids = identities(summaries);
    expect(ids.has('CustomerTier')).toBe(false);
    expect(ids.has('NotificationChannel')).toBe(true);
  });

  it('falls back to inferring a documented artifact only when the store has no contracts', async () => {
    const { summaries: withStore } = await inferInProcess(clone, {
      ref: { repoKey: storeRepo, commitSha: 'head' },
      dryRun: true,
    });
    const { summaries: withoutStore } = await inferInProcess(clone, {
      ref: { repoKey: emptyStoreRepo, commitSha: 'head' },
      dryRun: true,
    });

    // No store contracts → nothing is covered, so the documented enum reappears
    // (this is exactly the EE bug when infer read the empty clone disk).
    expect(identities(withoutStore).has('CustomerTier')).toBe(true);
    // Store coverage strictly reduces the inferred set.
    expect(withStore.length).toBeLessThan(withoutStore.length);
  });
});
