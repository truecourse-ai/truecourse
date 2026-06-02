import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep the real bucket helpers; replace only `trackEvent` with a spy so we can
// assert the spec→verify track emits the right events without hitting PostHog.
vi.mock('../../packages/core/src/services/telemetry.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/core/src/services/telemetry.service')>();
  return { ...actual, trackEvent: vi.fn(async () => {}) };
});

import { trackEvent } from '../../packages/core/src/services/telemetry.service';
import { scanInProcess, verifyInProcess } from '../../packages/core/src/commands/spec-in-process';
import { clearVerifyLatestCache } from '../../packages/core/src/lib/verify-store';

const FIXTURE = path.resolve(__dirname, '../fixtures/sample-js-project-il');
const CONTRACTS = path.join(FIXTURE, 'reference/contracts');
const CODE = path.join(FIXTURE, 'code');

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-telem-'));
  clearVerifyLatestCache();
  vi.mocked(trackEvent).mockClear();
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  clearVerifyLatestCache();
});

describe('spec → verify telemetry', () => {
  it('scanInProcess emits a spec_scan event when source is set', async () => {
    await scanInProcess(repo, { source: 'cli' });
    expect(trackEvent).toHaveBeenCalledWith('spec_scan', expect.objectContaining({ source: 'cli' }));
  });

  it('scanInProcess emits nothing when source is omitted (tests, internal re-scans)', async () => {
    await scanInProcess(repo, {});
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('verifyInProcess emits a verify event (mode full) with the source', async () => {
    await verifyInProcess(repo, {
      contractsDir: CONTRACTS,
      codeDir: CODE,
      skipStash: true,
      source: 'dashboard',
    });
    expect(trackEvent).toHaveBeenCalledWith(
      'verify',
      expect.objectContaining({ source: 'dashboard', mode: 'full' }),
    );
  });

  it('verifyInProcess stays silent without a source', async () => {
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE, skipStash: true });
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
