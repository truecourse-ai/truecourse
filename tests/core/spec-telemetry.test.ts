import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep the real bucket helpers; replace only `trackEvent` with a spy so we can
// assert the spec scan track emits the right events without hitting PostHog.
vi.mock('../../packages/core/src/services/telemetry.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/core/src/services/telemetry.service')>();
  return { ...actual, trackEvent: vi.fn(async () => {}) };
});

import { trackEvent } from '../../packages/core/src/services/telemetry.service';
import { curateInProcess } from '../../packages/core/src/commands/spec-in-process';

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-telem-'));
  vi.mocked(trackEvent).mockClear();
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('spec scan telemetry', () => {
  it('curateInProcess emits a spec_scan event when source is set', async () => {
    await curateInProcess(repo, { source: 'cli', skipGit: true });
    expect(trackEvent).toHaveBeenCalledWith('spec_scan', expect.objectContaining({ source: 'cli' }));
  });

  it('curateInProcess emits nothing when source is omitted (tests, internal re-scans)', async () => {
    await curateInProcess(repo, { skipGit: true });
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
