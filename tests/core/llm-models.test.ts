import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  STAGE_DEFAULTS,
  resolveModel,
  resolveFallbackModel,
  resolveStageModels,
  modelArgs,
  modelArgsForStage,
  describeStageResolutions,
} from '../../packages/core/src/config/llm-models.js';

// Every call below passes `repoDir` explicitly. The repo this suite runs in is
// itself a `.truecourse` project, so an accidental default-parameter call would
// read the repo's own config.json and pass/fail by machine state.

const ENV_KEYS = [
  'TRUECOURSE_MODEL',
  'CLAUDE_CODE_MODEL',
  'TRUECOURSE_FALLBACK_MODEL',
  'TRUECOURSE_MODEL_RULES_VIOLATION_GEN',
  'TRUECOURSE_MODEL_RULES_FLOW_ENRICH',
  'TRUECOURSE_MODEL_SPEC_AREA_TAG',
] as const;

const originals = new Map<string, string | undefined>();
for (const k of ENV_KEYS) originals.set(k, process.env[k]);

const tmpDirs: string[] = [];

/** A repo root with a `.truecourse/` marker and optional config.json body. */
function makeRepo(config?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-llm-models-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, '.truecourse'), { recursive: true });
  if (config !== undefined) {
    fs.writeFileSync(
      path.join(dir, '.truecourse', 'config.json'),
      typeof config === 'string' ? config : JSON.stringify(config),
      'utf-8',
    );
  }
  return dir;
}

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originals.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('STAGE_DEFAULTS — analyze rule stages', () => {
  it('declares both analyze stages with their re-tiered defaults', () => {
    // Violation detection is judgement, not authoring — the house rubric puts
    // that on sonnet. Flow enrichment only names an already-computed graph.
    expect(STAGE_DEFAULTS['rules.violationGen']).toBe('sonnet');
    expect(STAGE_DEFAULTS['rules.flowEnrich']).toBe('haiku');
  });
});

describe('resolveModel precedence', () => {
  it('falls back to the in-code default when nothing is configured', () => {
    const repo = makeRepo();
    expect(resolveModel('rules.violationGen', undefined, repo)).toBe('sonnet');
    expect(resolveModel('rules.flowEnrich', undefined, repo)).toBe('haiku');
  });

  it('reads config.json llm.stages.<id> over the default', () => {
    const repo = makeRepo({ llm: { stages: { 'rules.violationGen': 'opus' } } });
    expect(resolveModel('rules.violationGen', undefined, repo)).toBe('opus');
    // Sibling stage is untouched.
    expect(resolveModel('rules.flowEnrich', undefined, repo)).toBe('haiku');
  });

  it('TRUECOURSE_MODEL beats config.json', () => {
    const repo = makeRepo({ llm: { stages: { 'rules.violationGen': 'opus' } } });
    process.env.TRUECOURSE_MODEL = 'haiku';
    expect(resolveModel('rules.violationGen', undefined, repo)).toBe('haiku');
  });

  it('the per-stage env var beats TRUECOURSE_MODEL', () => {
    const repo = makeRepo({ llm: { stages: { 'rules.violationGen': 'opus' } } });
    process.env.TRUECOURSE_MODEL = 'haiku';
    process.env.TRUECOURSE_MODEL_RULES_VIOLATION_GEN = 'sonnet-1m';
    expect(resolveModel('rules.violationGen', undefined, repo)).toBe('sonnet-1m');
    // ...and only for that stage.
    expect(resolveModel('rules.flowEnrich', undefined, repo)).toBe('haiku');
  });

  it('derives the camelCase stage env var name with an underscore split', () => {
    const repo = makeRepo();
    process.env.TRUECOURSE_MODEL_RULES_FLOW_ENRICH = 'opus';
    expect(resolveModel('rules.flowEnrich', undefined, repo)).toBe('opus');
  });

  it('honors legacy CLAUDE_CODE_MODEL as a global override', () => {
    const repo = makeRepo();
    process.env.CLAUDE_CODE_MODEL = 'legacy-model';
    expect(resolveModel('rules.violationGen', undefined, repo)).toBe('legacy-model');
  });

  it('TRUECOURSE_MODEL beats legacy CLAUDE_CODE_MODEL', () => {
    const repo = makeRepo();
    process.env.CLAUDE_CODE_MODEL = 'legacy-model';
    process.env.TRUECOURSE_MODEL = 'new-model';
    expect(resolveModel('rules.violationGen', undefined, repo)).toBe('new-model');
  });

  it('repoDir null skips the config file entirely', () => {
    process.env.TRUECOURSE_MODEL_RULES_VIOLATION_GEN = 'opus';
    expect(resolveModel('rules.violationGen', undefined, null)).toBe('opus');
    delete process.env.TRUECOURSE_MODEL_RULES_VIOLATION_GEN;
    expect(resolveModel('rules.violationGen', undefined, null)).toBe('sonnet');
  });

  it('a malformed config.json falls through to the default without throwing', () => {
    const repo = makeRepo('{ not json');
    expect(resolveModel('rules.violationGen', undefined, repo)).toBe('sonnet');
  });

  it('an explicit defaultModel argument wins over STAGE_DEFAULTS', () => {
    const repo = makeRepo();
    expect(resolveModel('rules.violationGen', 'caller-default', repo)).toBe('caller-default');
  });
});

describe('resolveFallbackModel', () => {
  it('returns null when nothing is configured', () => {
    expect(resolveFallbackModel(makeRepo())).toBeNull();
  });

  it('reads llm.fallbackModel from config.json', () => {
    expect(resolveFallbackModel(makeRepo({ llm: { fallbackModel: 'haiku' } }))).toBe('haiku');
  });

  it('TRUECOURSE_FALLBACK_MODEL beats config.json', () => {
    process.env.TRUECOURSE_FALLBACK_MODEL = 'sonnet';
    expect(resolveFallbackModel(makeRepo({ llm: { fallbackModel: 'haiku' } }))).toBe('sonnet');
  });
});

describe('resolveStageModels / modelArgs', () => {
  it('bundles the primary and (absent) fallback', () => {
    expect(resolveStageModels('rules.violationGen', undefined, makeRepo())).toEqual({
      model: 'sonnet',
    });
  });

  it('carries the fallback when one is configured', () => {
    const repo = makeRepo({ llm: { stages: { 'rules.violationGen': 'opus' }, fallbackModel: 'haiku' } });
    expect(resolveStageModels('rules.violationGen', undefined, repo)).toEqual({
      model: 'opus',
      fallbackModel: 'haiku',
    });
  });

  it('modelArgs emits --model then --fallback-model, and nothing for an empty selection', () => {
    expect(modelArgs({})).toEqual([]);
    expect(modelArgs({ model: 'opus' })).toEqual(['--model', 'opus']);
    expect(modelArgs({ model: 'opus', fallbackModel: 'haiku' })).toEqual([
      '--model',
      'opus',
      '--fallback-model',
      'haiku',
    ]);
    // A fallback with no primary still emits its own flag.
    expect(modelArgs({ fallbackModel: 'haiku' })).toEqual(['--fallback-model', 'haiku']);
  });

  it('modelArgsForStage is the composition of the two', () => {
    const repo = makeRepo({ llm: { fallbackModel: 'haiku' } });
    expect(modelArgsForStage('rules.flowEnrich', undefined, repo)).toEqual([
      '--model',
      'haiku',
      '--fallback-model',
      'haiku',
    ]);
  });
});

describe('describeStageResolutions', () => {
  it('reports every stage, including both analyze stages', () => {
    const { stages } = describeStageResolutions(makeRepo());
    const ids = stages.map((s) => s.stageId);
    expect(ids).toContain('rules.violationGen');
    expect(ids).toContain('rules.flowEnrich');
    expect(ids).toHaveLength(Object.keys(STAGE_DEFAULTS).length);
  });

  it('labels the source for each rung of the precedence chain', () => {
    const repo = makeRepo({ llm: { stages: { 'rules.flowEnrich': 'sonnet' } } });

    const byId = (r: ReturnType<typeof describeStageResolutions>, id: string) =>
      r.stages.find((s) => s.stageId === id)!;

    let out = describeStageResolutions(repo);
    expect(byId(out, 'rules.violationGen')).toMatchObject({ effectiveModel: 'sonnet', source: 'default' });
    expect(byId(out, 'rules.flowEnrich')).toMatchObject({ effectiveModel: 'sonnet', source: 'config' });

    process.env.CLAUDE_CODE_MODEL = 'legacy';
    out = describeStageResolutions(repo);
    expect(byId(out, 'rules.violationGen')).toMatchObject({
      effectiveModel: 'legacy',
      source: 'env-legacy',
      envVar: 'CLAUDE_CODE_MODEL',
    });

    process.env.TRUECOURSE_MODEL = 'global';
    out = describeStageResolutions(repo);
    expect(byId(out, 'rules.violationGen')).toMatchObject({
      effectiveModel: 'global',
      source: 'env-global',
      envVar: 'TRUECOURSE_MODEL',
    });

    process.env.TRUECOURSE_MODEL_RULES_VIOLATION_GEN = 'staged';
    out = describeStageResolutions(repo);
    expect(byId(out, 'rules.violationGen')).toMatchObject({
      effectiveModel: 'staged',
      source: 'env-stage',
      envVar: 'TRUECOURSE_MODEL_RULES_VIOLATION_GEN',
    });
    // The sibling stage still reports the global env, not the per-stage one.
    expect(byId(out, 'rules.flowEnrich')).toMatchObject({ effectiveModel: 'global', source: 'env-global' });
  });

  it('carries the resolved fallback model', () => {
    const repo = makeRepo({ llm: { fallbackModel: 'haiku' } });
    expect(describeStageResolutions(repo).fallbackModel).toBe('haiku');
  });
});
