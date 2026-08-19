/**
 * MODEL RESOLUTION after the one-shot retirement (plan 04 step 20).
 *
 * `resolveGuardModels` shrank to the two stages that still ride the transport —
 * `{ match, recipe, fallback }`. Every other guard-generate stage is an agent
 * SESSION on the ONE configured session model (§3.4), so the per-stage table can
 * no longer influence them: a config file still naming a retired id
 * (`guard.extract`, `guard.generate`, `guard.fidelity`, `guard.triage`, …) must
 * LOAD without complaint and change nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GuardGenerateModels } from '@truecourse/guard-generator';
import { writeGlobalConfig } from '../../packages/core/src/config/global-config.js';
import { STAGE_DEFAULTS, resolveModel } from '../../packages/core/src/config/llm-models.js';
import { createConfiguredSessionDriver } from '../../packages/core/src/services/llm/session-driver.js';
import { estimateGuardTokens } from '../../packages/core/src/services/llm/spec-estimate.js';
import {
  EXTRACT_SESSION_KIND,
  FLOWS_SESSION_KIND,
  FLOW_WORKER_SESSION_KIND,
  FIDELITY_SESSION_KIND,
} from '../../packages/core/src/services/guard-generate/index.js';
import { makeTempRepo, rmrf, writeCorpus, writeDoc, writeRecipe } from '../guard-generator/helpers.js';

const API_MODEL = 'gpt-5.5';
const DOC = 'docs/cli.md';
const DOC_CONTENT = '## version\n`relkit --version` prints the version and exits 0.\n';

/** The retired per-stage ids a committed config.json may still carry. */
const RETIRED_STAGE_IDS = [
  'guard.extract',
  'guard.flows',
  'guard.generate',
  'guard.retry',
  'guard.fidelity',
  'guard.triage',
];

let home: string;
const dirs: string[] = [];
const repos: string[] = [];
const savedEnv = { ...process.env };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-models-home-'));
  dirs.push(home);
  process.env.TRUECOURSE_HOME = home;
  delete process.env.TRUECOURSE_LLM_TRANSPORT;
  writeGlobalConfig({
    llm: { transport: 'api', api: { provider: 'openai', model: API_MODEL, apiKey: 'sk-test' } },
  });
});

afterEach(() => {
  process.env = { ...savedEnv };
  while (repos.length) rmrf(repos.pop()!);
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A guard repo whose committed config still overrides every RETIRED stage id. */
function repoWithStaleStageTable(): string {
  const r = makeTempRepo();
  repos.push(r);
  writeRecipe(r);
  writeCorpus(r, [{ ref: DOC }]);
  writeDoc(r, DOC, DOC_CONTENT);
  fs.writeFileSync(
    path.join(r, '.truecourse', 'config.json'),
    JSON.stringify({ llm: { stages: Object.fromEntries(RETIRED_STAGE_IDS.map((id) => [id, 'haiku'])) } }, null, 2),
  );
  return r;
}

describe('GuardGenerateModels — the shape the retirement left', () => {
  it('accepts only the two surviving one-shots plus the fallback', () => {
    const models: GuardGenerateModels = { match: 'sonnet', recipe: 'sonnet', fallback: 'sonnet' };
    expect(Object.keys(models).sort()).toEqual(['fallback', 'match', 'recipe']);
  });

  it('no longer admits a retired session stage', () => {
    // @ts-expect-error — `extract` and `triage` became agent sessions; they have
    // no per-stage tier, so naming one here must not compile.
    const stale: GuardGenerateModels = { match: 'sonnet', extract: 'opus', triage: 'opus' };
    expect(stale.match).toBe('sonnet');
  });
});

describe('the per-stage table no longer reaches a session stage', () => {
  it('a stale `guard.generate` override leaves the session driver on the api model', () => {
    repoWithStaleStageTable();

    const { mode, attribution } = createConfiguredSessionDriver({ transport: 'api' });
    expect(mode).toBe('api');
    // The ONE model, from `llm.api.model` — never a per-stage tier.
    expect(attribution.model).toBe(API_MODEL);
    expect(attribution.model).not.toBe('haiku');
  });

  it('the estimate quotes every SESSION stage on that one model, and the one-shots on their own', async () => {
    const r = repoWithStaleStageTable();

    const stages = new Map(
      ((await estimateGuardTokens(r, undefined, { mode: 'api' })).stages ?? []).map((s) => [s.stage, s.model]),
    );
    for (const kind of [
      EXTRACT_SESSION_KIND,
      FLOWS_SESSION_KIND,
      FLOW_WORKER_SESSION_KIND,
      FIDELITY_SESSION_KIND,
    ]) {
      expect(stages.get(kind), kind).toBe(API_MODEL);
    }
    // The surviving one-shots resolve through the table as they always did — in
    // api mode that is still the one configured model.
    expect(stages.get('guardMatch')).toBe(API_MODEL);
  });

  it('a stale override on a retired id is inert, while a LIVE id still resolves', () => {
    const r = repoWithStaleStageTable();

    // Retired ids: nothing reads them — the file loads, the value is ignored.
    // (`resolveModel` only ever queries live ids; the type no longer names these.)
    for (const id of RETIRED_STAGE_IDS) {
      expect(Object.keys(STAGE_DEFAULTS)).not.toContain(id);
    }
    // A live one-shot still honors the table in claude-code mode.
    fs.writeFileSync(
      path.join(r, '.truecourse', 'config.json'),
      JSON.stringify({ llm: { stages: { 'guard.match': 'haiku' } } }, null, 2),
    );
    expect(resolveModel('guard.match', undefined, r, 'claude-code')).toBe('haiku');
    expect(STAGE_DEFAULTS['guard.match']).toBe('sonnet');
  });
});
