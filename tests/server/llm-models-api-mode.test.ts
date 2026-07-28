/**
 * Per-stage model resolution in API mode: the one configured model replaces the
 * in-code Claude tier aliases (which mean nothing to a provider API), while
 * every explicit override — per-stage env, global env, repo `llm.stages` —
 * still wins ahead of it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeGlobalConfig } from '../../packages/core/src/config/global-config.js';
import {
  STAGE_DEFAULTS,
  describeStageResolutions,
  resolveFallbackModel,
  resolveModel,
} from '../../packages/core/src/config/llm-models.js';

let home: string;
let repoDir: string;
const savedEnv = { ...process.env };

const API_MODEL = 'claude-sonnet-4-5';

function saveApiMode(fallbackModel?: string): void {
  writeGlobalConfig({
    llm: {
      transport: 'api',
      api: { provider: 'anthropic', model: API_MODEL, fallbackModel, apiKey: 'sk-test' },
    },
  });
}

function writeRepoConfig(config: unknown): void {
  const dir = path.join(repoDir, '.truecourse');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-llm-models-home-'));
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-llm-models-repo-'));
  process.env.TRUECOURSE_HOME = home;
  delete process.env.TRUECOURSE_LLM_TRANSPORT;
  delete process.env.TRUECOURSE_MODEL;
  delete process.env.CLAUDE_CODE_MODEL;
  delete process.env.TRUECOURSE_MODEL_SPEC_RELEVANCE;
  delete process.env.TRUECOURSE_FALLBACK_MODEL;
});

afterEach(() => {
  process.env = { ...savedEnv };
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('resolveModel in API mode', () => {
  it('keeps the in-code tier defaults in claude-code mode', () => {
    expect(resolveModel('spec.relevance', undefined, repoDir)).toBe(STAGE_DEFAULTS['spec.relevance']);
    expect(resolveModel('contract.extract', undefined, repoDir)).toBe('opus');
  });

  it('runs every unoverridden stage on the configured api model', () => {
    saveApiMode();
    expect(resolveModel('spec.relevance', undefined, repoDir)).toBe(API_MODEL);
    expect(resolveModel('contract.extract', undefined, repoDir)).toBe(API_MODEL);
    expect(resolveModel('guard.generate', undefined, null)).toBe(API_MODEL);
  });

  it('applies to the saved selection even when the mode comes from the env', () => {
    writeGlobalConfig({
      llm: { transport: 'claude-code', api: { provider: 'openai', model: 'gpt-4o' } },
    });
    expect(resolveModel('spec.vocab', undefined, repoDir)).toBe(STAGE_DEFAULTS['spec.vocab']);
    process.env.TRUECOURSE_LLM_TRANSPORT = 'api';
    expect(resolveModel('spec.vocab', undefined, repoDir)).toBe('gpt-4o');
  });

  it('lets a per-stage env var win', () => {
    saveApiMode();
    process.env.TRUECOURSE_MODEL_SPEC_RELEVANCE = 'gpt-4o-mini';
    expect(resolveModel('spec.relevance', undefined, repoDir)).toBe('gpt-4o-mini');
    expect(resolveModel('spec.vocab', undefined, repoDir)).toBe(API_MODEL);
  });

  it('lets the global env var win', () => {
    saveApiMode();
    process.env.TRUECOURSE_MODEL = 'gpt-4o';
    expect(resolveModel('spec.relevance', undefined, repoDir)).toBe('gpt-4o');
  });

  it('lets a repo llm.stages override win', () => {
    saveApiMode();
    writeRepoConfig({ llm: { stages: { 'spec.relevance': 'gpt-4o-mini' } } });
    expect(resolveModel('spec.relevance', undefined, repoDir)).toBe('gpt-4o-mini');
    expect(resolveModel('spec.vocab', undefined, repoDir)).toBe(API_MODEL);
  });

  it('falls back to the in-code default when api mode has no model saved', () => {
    writeGlobalConfig({ llm: { transport: 'api' } });
    expect(resolveModel('spec.relevance', undefined, repoDir)).toBe(STAGE_DEFAULTS['spec.relevance']);
  });
});

describe('describeStageResolutions in API mode', () => {
  it('reports api-config for stages the user did not override', () => {
    saveApiMode();
    writeRepoConfig({ llm: { stages: { 'spec.relevance': 'gpt-4o-mini' } } });
    process.env.TRUECOURSE_MODEL_SPEC_VOCAB = 'gpt-4o';

    const { stages } = describeStageResolutions(repoDir);
    const byId = new Map(stages.map((s) => [s.stageId, s]));
    expect(byId.get('spec.relevance')).toMatchObject({
      effectiveModel: 'gpt-4o-mini',
      source: 'config',
    });
    expect(byId.get('spec.vocab')).toMatchObject({
      effectiveModel: 'gpt-4o',
      source: 'env-stage',
      envVar: 'TRUECOURSE_MODEL_SPEC_VOCAB',
    });
    expect(byId.get('contract.extract')).toMatchObject({
      effectiveModel: API_MODEL,
      source: 'api-config',
    });
    delete process.env.TRUECOURSE_MODEL_SPEC_VOCAB;
  });

  it('reports default sources in claude-code mode', () => {
    const { stages } = describeStageResolutions(repoDir);
    expect(stages.every((s) => s.source === 'default')).toBe(true);
  });
});

describe('resolveFallbackModel in API mode', () => {
  it('uses the api fallback model as the last resort', () => {
    saveApiMode('claude-haiku-4-5');
    expect(resolveFallbackModel(repoDir)).toBe('claude-haiku-4-5');
  });

  it('is null when the api config has no fallback', () => {
    saveApiMode();
    expect(resolveFallbackModel(repoDir)).toBeNull();
  });

  it('keeps env and repo config ahead of it', () => {
    saveApiMode('claude-haiku-4-5');
    writeRepoConfig({ llm: { fallbackModel: 'repo-fallback' } });
    expect(resolveFallbackModel(repoDir)).toBe('repo-fallback');

    process.env.TRUECOURSE_FALLBACK_MODEL = 'env-fallback';
    expect(resolveFallbackModel(repoDir)).toBe('env-fallback');
  });

  it('stays null in claude-code mode', () => {
    writeGlobalConfig({
      llm: {
        transport: 'claude-code',
        api: { provider: 'anthropic', model: API_MODEL, fallbackModel: 'claude-haiku-4-5' },
      },
    });
    expect(resolveFallbackModel(repoDir)).toBeNull();
  });
});
