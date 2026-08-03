import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { modelConfigSandbox } from '../helpers/model-config.js';
import { ClaudeCodeProvider } from '../../packages/core/src/services/llm/cli-provider.js';
import type { LlmRequest, LlmTransport } from '../../packages/shared/src/llm/transport.js';

// #799: `analyze` never sent a `--model` flag, so the spawned `claude` fell back
// to whatever each developer's ~/.claude/settings.json said. These tests pin the
// resolved selection to the documented precedence chain instead.

const sandbox = modelConfigSandbox();
const { makeRepo, writeConfig, makeTmpDir } = sandbox;

/** Records every request and answers with a schema-valid payload for the call. */
function captureTransport(seen: LlmRequest[]): LlmTransport {
  return async (req) => {
    seen.push(req);
    if (req.stage === 'analyze.flow') {
      return JSON.stringify({ name: 'F', description: 'D', stepDescriptions: [] });
    }
    return JSON.stringify({ violations: [], serviceDescriptions: [] });
  };
}

const SERVICE_CTX = {
  architecture: 'monolith',
  services: [],
  dependencies: [],
  llmRules: [],
};

const FLOW_CTX = {
  flowName: 'f',
  entryService: 's',
  entryMethod: 'm',
  trigger: 't',
  steps: [],
};

beforeEach(() => sandbox.reset());
afterEach(() => sandbox.cleanup());

describe('ClaudeCodeProvider — per-stage model selection', () => {
  it('sends the stage default when nothing is configured (regression for #799)', async () => {
    const seen: LlmRequest[] = [];
    const provider = new ClaudeCodeProvider(captureTransport(seen));
    provider.setRepoPath(makeRepo());

    await provider.generateServiceViolations(SERVICE_CTX);

    // Pre-fix this was `undefined` — no --model, no reproducibility.
    expect(seen[0].model).toBe('sonnet');
    expect(seen[0].fallbackModel).toBeUndefined();
  });

  it('honors config.json per-stage model and fallbackModel', async () => {
    const seen: LlmRequest[] = [];
    const provider = new ClaudeCodeProvider(captureTransport(seen));
    provider.setRepoPath(
      makeRepo({ llm: { stages: { 'rules.violationGen': 'opus' }, fallbackModel: 'haiku' } }),
    );

    await provider.generateServiceViolations(SERVICE_CTX);

    expect(seen[0].model).toBe('opus');
    // Structurally impossible pre-fix: the transport path never set a fallback.
    expect(seen[0].fallbackModel).toBe('haiku');
  });

  it('routes enrichFlow to rules.flowEnrich while violation calls stay on rules.violationGen', async () => {
    const seen: LlmRequest[] = [];
    const provider = new ClaudeCodeProvider(captureTransport(seen));
    provider.setRepoPath(makeRepo());

    await provider.generateServiceViolations(SERVICE_CTX);
    await provider.enrichFlow(FLOW_CTX);

    expect(seen[0].model).toBe('sonnet');
    expect(seen[1].model).toBe('haiku');
  });

  it('lets the two analyze stages be configured independently', async () => {
    const seen: LlmRequest[] = [];
    const provider = new ClaudeCodeProvider(captureTransport(seen));
    provider.setRepoPath(makeRepo({ llm: { stages: { 'rules.flowEnrich': 'sonnet' } } }));

    await provider.generateServiceViolations(SERVICE_CTX);
    await provider.enrichFlow(FLOW_CTX);

    expect(seen[0].model).toBe('sonnet'); // default, untouched
    expect(seen[1].model).toBe('sonnet'); // config override
  });

  it('walks up from a scan root that is a subdirectory of the repo', async () => {
    const repo = makeRepo({ llm: { stages: { 'rules.violationGen': 'opus' } } });
    const sub = path.join(repo, 'src', 'sub');
    fs.mkdirSync(sub, { recursive: true });

    const seen: LlmRequest[] = [];
    const provider = new ClaudeCodeProvider(captureTransport(seen));
    provider.setRepoPath(sub);

    await provider.generateServiceViolations(SERVICE_CTX);

    expect(seen[0].model).toBe('opus');
  });

  it('falls back to the stage default when no repo path was set — never process.cwd()', async () => {
    const seen: LlmRequest[] = [];
    const provider = new ClaudeCodeProvider(captureTransport(seen));

    await provider.generateServiceViolations(SERVICE_CTX);

    expect(seen[0].model).toBe('sonnet');
  });

  it('degrades to env + defaults when the repo path has no .truecourse marker', async () => {
    const bare = makeTmpDir('tc-provider-bare-');
    process.env.TRUECOURSE_MODEL_RULES_VIOLATION_GEN = 'opus';

    const seen: LlmRequest[] = [];
    const provider = new ClaudeCodeProvider(captureTransport(seen));
    provider.setRepoPath(bare);

    await provider.generateServiceViolations(SERVICE_CTX);

    expect(seen[0].model).toBe('opus');
  });

  it('memoizes the selection per stage, and re-resolves on setRepoPath', async () => {
    const repo = makeRepo({ llm: { stages: { 'rules.violationGen': 'opus' } } });
    const seen: LlmRequest[] = [];
    const provider = new ClaudeCodeProvider(captureTransport(seen));
    provider.setRepoPath(repo);

    await provider.generateServiceViolations(SERVICE_CTX);
    writeConfig(repo, { llm: { stages: { 'rules.violationGen': 'haiku' } } });
    await provider.generateServiceViolations(SERVICE_CTX);

    expect(seen.map((r) => r.model)).toEqual(['opus', 'opus']);

    provider.setRepoPath(repo);
    await provider.generateServiceViolations(SERVICE_CTX);
    expect(seen[2].model).toBe('haiku');
  });

  it('still honors legacy CLAUDE_CODE_MODEL', async () => {
    process.env.CLAUDE_CODE_MODEL = 'legacy-model';
    const seen: LlmRequest[] = [];
    const provider = new ClaudeCodeProvider(captureTransport(seen));
    provider.setRepoPath(makeRepo());

    await provider.generateServiceViolations(SERVICE_CTX);

    expect(seen[0].model).toBe('legacy-model');
  });
});
