/**
 * The dashboard server's half of the LLM transport wiring: it installs the
 * selection saved by `truecourse config llm setup` at boot and re-checks it at
 * every pipeline entry (spec scan, guard generate, analyze, flow enrich), so a
 * dashboard-triggered run reaches the same model the CLI would — and a setup run
 * while the dashboard is up takes effect without a restart.
 *
 * The engines are mocked (never a real LLM call); what's asserted is the
 * process-wide default transport around each entry, the enterprise gate (EE
 * installs its own from its encrypted store — OSS must never touch it), and the
 * typed config error reaching the client through the existing error plumbing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import { type Express } from 'express';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  const tracker = () => ({ start() {}, done() {}, error() {}, detail() {} });
  return {
    ...actual,
    createSocketSpecTracker: tracker,
    createSocketTracker: tracker,
    createSocketSpecEstimateHandler: () => async () => true,
    createSocketLlmEstimateHandler: () => async () => true,
    createSocketStashConfirmHandler: () => async () => 'stash',
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
  };
});

vi.mock('@truecourse/core/commands/guard-in-process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@truecourse/core/commands/guard-in-process')>()),
  guardGenerateInProcess: vi.fn(),
}));

vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>()),
  curateInProcess: vi.fn(),
}));

vi.mock('@truecourse/core/commands/analyze-in-process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@truecourse/core/commands/analyze-in-process')>()),
  analyzeInProcess: vi.fn(),
}));

vi.mock('@truecourse/core/services/flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@truecourse/core/services/flow')>()),
  getFlowFromLatest: vi.fn(),
  enrichFlowWithLLM: vi.fn(),
}));

// The dist entries the dashboard server itself imports — the source copies would
// be different module instances, with their own default-transport slot.
import { getDefaultTransport, setDefaultTransport, type LlmTransport } from '@truecourse/shared/llm';
import { writeGlobalConfig, type GlobalConfig } from '@truecourse/core/config/global-config';
import { resetConfiguredLlmTransport } from '@truecourse/core/services/llm/install-transport';
import { log } from '@truecourse/core/lib/logger';
import { guardGenerateInProcess } from '@truecourse/core/commands/guard-in-process';
import { curateInProcess } from '@truecourse/core/commands/spec-in-process';
import { analyzeInProcess } from '@truecourse/core/commands/analyze-in-process';
import { getFlowFromLatest, enrichFlowWithLLM } from '@truecourse/core/services/flow';
import { createApp } from '../../apps/dashboard/server/src/app';
import { installLlmTransportAtBoot } from '../../apps/dashboard/server/src/services/llm-transport.service';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

const savedEnv = { ...process.env };
const sentinel: LlmTransport = async () => 'enterprise';

function apiConfig(over: Partial<NonNullable<NonNullable<GlobalConfig['llm']>['api']>> = {}): GlobalConfig {
  return {
    llm: {
      transport: 'api',
      api: { provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-test', ...over },
    },
  };
}

describe('Dashboard server LLM transport install', () => {
  let app: Express;
  let fixture: TestFixture;
  let home: string;

  beforeEach(async () => {
    // Own the global config dir AND the registry for this test, exactly like the
    // core install-transport suite: nothing reads the developer's real home.
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-dash-llm-home-'));
    process.env.TRUECOURSE_HOME = home;
    delete process.env.TRUECOURSE_LLM_TRANSPORT;
    delete process.env.TRUECOURSE_EDITION;
    delete process.env.ANTHROPIC_API_KEY;

    setDefaultTransport(undefined);
    resetConfiguredLlmTransport();
    vi.mocked(guardGenerateInProcess).mockReset().mockResolvedValue({
      guard: { status: 'ok', noChanges: false, written: [], birthFindings: [] },
    } as never);
    vi.mocked(curateInProcess).mockReset().mockResolvedValue({ noChanges: false } as never);
    vi.mocked(analyzeInProcess).mockReset().mockResolvedValue({ analysisId: 'a1' } as never);
    vi.mocked(getFlowFromLatest).mockReset().mockResolvedValue({ id: 'f1', name: 'Checkout' } as never);
    vi.mocked(enrichFlowWithLLM).mockReset().mockResolvedValue(undefined as never);

    fixture = await setupTestFixture();
    execFileSync('git', ['init'], { cwd: fixture.repoPath, stdio: 'ignore' });
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
    setDefaultTransport(undefined);
    resetConfiguredLlmTransport();
    process.env = { ...savedEnv };
    fs.rmSync(home, { recursive: true, force: true });
  });

  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/${suffix}`;

  // --- Boot ----------------------------------------------------------------

  it('installs the saved API transport at boot (community)', () => {
    writeGlobalConfig(apiConfig());
    installLlmTransportAtBoot();
    expect(typeof getDefaultTransport()).toBe('function');
  });

  it('installs nothing at boot in claude-code mode', () => {
    writeGlobalConfig({ llm: { transport: 'claude-code', api: apiConfig().llm!.api } });
    installLlmTransportAtBoot();
    expect(getDefaultTransport()).toBeUndefined();
  });

  it('skips the boot install in enterprise mode, leaving EE\'s own transport alone', () => {
    process.env.TRUECOURSE_EDITION = 'enterprise';
    // EE registered its transport from the encrypted store before this point.
    setDefaultTransport(sentinel);
    writeGlobalConfig(apiConfig());
    installLlmTransportAtBoot();
    expect(getDefaultTransport()).toBe(sentinel);
  });

  it('warns and boots anyway when the saved API config is unusable', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    writeGlobalConfig({ llm: { transport: 'api' } });
    expect(() => installLlmTransportAtBoot()).not.toThrow();
    expect(getDefaultTransport()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/truecourse config llm setup/));
    warn.mockRestore();
  });

  // --- Pipeline entry points -----------------------------------------------

  it('re-installs at a pipeline entry after the config changes (no restart)', async () => {
    writeGlobalConfig({ llm: { transport: 'claude-code' } });
    installLlmTransportAtBoot();
    expect(getDefaultTransport()).toBeUndefined();

    // `truecourse config llm setup` runs while the dashboard is up.
    writeGlobalConfig(apiConfig());

    await request(app).post(url('guard/generate')).send({ confirmed: true }).expect(200);
    const installed = getDefaultTransport();
    expect(typeof installed).toBe('function');

    // Config unchanged ⇒ the mtime-cached install reuses what it built.
    await request(app).post(url('guard/generate')).send({ confirmed: true }).expect(200);
    expect(getDefaultTransport()).toBe(installed);
  });

  it('installs the API transport at every LLM pipeline entry', async () => {
    const entries: [string, () => Promise<unknown>][] = [
      ['guard generate', () => request(app).post(url('guard/generate')).send({ confirmed: true }).expect(200)],
      ['spec scan', () => request(app).get(url('spec/corpus/scan')).expect(200)],
      [
        'analyze',
        async () => {
          await request(app).post(url('analyses')).send({ mode: 'full' }).expect(202);
          // The 202 is fire-and-forget — wait for the run so its call cannot
          // leak past a later test's mockReset.
          await vi.waitFor(() => expect(vi.mocked(analyzeInProcess)).toHaveBeenCalledOnce());
        },
      ],
      ['flow enrich', () => request(app).post(url('flows/f1/enrich')).expect(200)],
    ];
    for (const [name, hit] of entries) {
      setDefaultTransport(undefined);
      resetConfiguredLlmTransport();
      writeGlobalConfig(apiConfig());
      await hit();
      expect(typeof getDefaultTransport(), name).toBe('function');
    }
  });

  it('never installs at a pipeline entry in enterprise mode', async () => {
    process.env.TRUECOURSE_EDITION = 'enterprise';
    setDefaultTransport(sentinel);
    writeGlobalConfig(apiConfig());

    await request(app).post(url('guard/generate')).send({ confirmed: true }).expect(200);
    await request(app).get(url('spec/corpus/scan')).expect(200);
    await request(app).post(url('flows/f1/enrich')).expect(200);
    expect(getDefaultTransport()).toBe(sentinel);
  });

  it('leaves analyze alone when LLM rules are off, however broken the API config', async () => {
    fs.mkdirSync(path.join(fixture.repoPath, '.truecourse'), { recursive: true });
    fs.writeFileSync(
      path.join(fixture.repoPath, '.truecourse/config.json'),
      JSON.stringify({ enableLlmRules: false }),
    );
    writeGlobalConfig({ llm: { transport: 'api' } });

    await request(app).post(url('analyses')).send({ mode: 'full' }).expect(202);
    // The 202 is fire-and-forget: the run itself starts after the response, so
    // wait for it here — both because the run happening IS this test's claim,
    // and so the in-flight call cannot leak past the next test's mockReset.
    await vi.waitFor(() => expect(vi.mocked(analyzeInProcess)).toHaveBeenCalledOnce());
  });

  // --- The typed error reaching the client ---------------------------------

  it('surfaces the LlmApiConfigError message from the guard generate route', async () => {
    writeGlobalConfig({ llm: { transport: 'api' } });
    const res = await request(app).post(url('guard/generate')).send({ confirmed: true }).expect(500);
    expect(res.body.error).toMatch(/truecourse config llm setup/);
    expect(vi.mocked(guardGenerateInProcess)).not.toHaveBeenCalled();
  });

  it('surfaces the LlmApiConfigError message from the spec scan route', async () => {
    writeGlobalConfig(apiConfig({ apiKey: undefined }));
    const res = await request(app).get(url('spec/corpus/scan')).expect(500);
    expect(res.body.error).toMatch(/ANTHROPIC_API_KEY.*truecourse config llm setup/s);
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();
  });

  it('answers the analyze POST with the config error instead of accepting the run', async () => {
    writeGlobalConfig({ llm: { transport: 'api' } });
    const res = await request(app).post(url('analyses')).send({ mode: 'full' }).expect(500);
    expect(res.body.error).toMatch(/truecourse config llm setup/);
    expect(vi.mocked(analyzeInProcess)).not.toHaveBeenCalled();
  });

  it('surfaces the LlmApiConfigError message from the flow enrich route', async () => {
    writeGlobalConfig({ llm: { transport: 'api' } });
    const res = await request(app).post(url('flows/f1/enrich')).expect(500);
    expect(res.body.error).toMatch(/truecourse config llm setup/);
    expect(vi.mocked(enrichFlowWithLLM)).not.toHaveBeenCalled();
  });
});
