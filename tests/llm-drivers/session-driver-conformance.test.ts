/**
 * The driver CONFORMANCE SUITE (AGENTIC_PIPELINE_PLAN §3.3): both session
 * drivers — api (per-turn generateText loop) and Agent SDK (streaming-input
 * subprocess) — run through ONE spec via `runAgentLoop`, which is what keeps
 * two mechanical drivers one semantic loop. Each fixture translates the
 * abstract scenario into its backend's scripting; the assertions are shared.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const { buildModelMock } = vi.hoisted(() => ({ buildModelMock: vi.fn() }));
vi.mock('../../packages/llm-api/src/model.js', () => ({ buildModel: buildModelMock }));

import { createApiSessionDriver, OUTCOME_TOOL_NAME } from '../../packages/llm-api/src/index';
import {
  createClaudeAgentSessionDriver,
  SESSION_MCP_SERVER_NAME,
} from '../../packages/llm-claude-agent/src/index';
import type { SdkMessage, SdkModule } from '../../packages/llm-claude-agent/src/sdk-types';
import {
  runAgentLoop,
  type AgentLoopInput,
  type SessionDef,
  type SessionDriver,
  type SessionEvent,
  type SessionIndexEntry,
  type SessionPersistence,
} from '../../packages/agent-loop/src/index';
import { defineSessionTool } from '../../packages/agent-loop/src/index';

// ---------------------------------------------------------------------------
// the abstract scenario a backend plays
// ---------------------------------------------------------------------------

type ScenarioStep =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; args: unknown }
  | { kind: 'await-user' }
  | { kind: 'outcome'; value: unknown };
// After the steps run out the backend keeps producing text turns forever —
// which is exactly what a session that never converges looks like.

interface Fixture {
  name: string;
  make(steps: ScenarioStep[]): SessionDriver;
}

// ---------------------------------------------------------------------------
// api fixture: scripted LanguageModelV3 behind the real generateText
// ---------------------------------------------------------------------------

const cfg = { provider: 'anthropic' as const, model: 'primary-model', apiKey: 'test' };

function apiFixture(): Fixture {
  return {
    name: 'api driver',
    make(steps) {
      const remaining = [...steps.filter((s) => s.kind !== 'await-user')];
      let n = 0;
      const stub = {
        specificationVersion: 'v3',
        provider: 'mock',
        modelId: 'mock-model',
        supportedUrls: {},
        async doGenerate() {
          // A real model call takes wall-clock time; without it the whole
          // session resolves in one microtask chain and a mid-run steer has
          // no window to land in.
          await new Promise((r) => setTimeout(r, 10));
          const step = remaining.shift() ?? { kind: 'text' as const, text: `filler ${n++}` };
          const content =
            step.kind === 'text'
              ? [{ type: 'text', text: step.text }]
              : step.kind === 'tool'
                ? [{ type: 'tool-call', toolCallId: `c${n++}`, toolName: step.name, input: JSON.stringify(step.args) }]
                : [{ type: 'tool-call', toolCallId: `c${n++}`, toolName: OUTCOME_TOOL_NAME, input: JSON.stringify(step.value) }];
          return {
            content,
            finishReason: 'stop',
            usage: {
              inputTokens: { total: 100, noCache: 100 },
              outputTokens: { total: 10, text: 10, reasoning: undefined },
            },
            warnings: [],
          };
        },
        async doStream() {
          throw new Error('doStream not used');
        },
      };
      buildModelMock.mockReturnValue(stub);
      return createApiSessionDriver(cfg);
    },
  };
}

// ---------------------------------------------------------------------------
// sdk fixture: scripted query() behind the real driver
// ---------------------------------------------------------------------------

function sdkFixture(): Fixture {
  return {
    name: 'agent-sdk driver',
    make(steps) {
      const tools = new Map<string, (args: unknown, extra: unknown) => Promise<unknown>>();
      const sdk: SdkModule = {
        tool(name, _description, _shape, handler) {
          tools.set(name, handler);
          return { name, handler };
        },
        createSdkMcpServer(options) {
          return { type: 'sdk', name: options.name };
        },
        query({ prompt, options }) {
          let interrupted = false;
          const iterator = prompt[Symbol.asyncIterator]();
          async function* generate(): AsyncGenerator<SdkMessage, void> {
            await iterator.next(); // the opening message
            yield {
              type: 'system',
              subtype: 'init',
              session_id: 'prov-1',
              mcp_servers: [{ name: SESSION_MCP_SERVER_NAME, status: 'connected' }],
            };
            let n = 0;
            const remaining = [...steps];
            for (;;) {
              if (interrupted) {
                yield { type: 'result', subtype: 'success', is_error: false, session_id: 'prov-1' };
                return;
              }
              const step = remaining.shift() ?? { kind: 'text' as const, text: `filler ${n++}` };
              if (step.kind === 'await-user') {
                await iterator.next();
                continue;
              }
              if (step.kind === 'outcome') {
                yield {
                  type: 'result',
                  subtype: 'success',
                  is_error: false,
                  session_id: 'prov-1',
                  structured_output: step.value,
                };
                return;
              }
              if (step.kind === 'tool') {
                yield {
                  type: 'assistant',
                  parent_tool_use_id: null,
                  session_id: 'prov-1',
                  message: {
                    content: [
                      {
                        type: 'tool_use',
                        id: `tu${n++}`,
                        name: `mcp__${SESSION_MCP_SERVER_NAME}__${step.name}`,
                        input: step.args,
                      },
                    ],
                    usage: { input_tokens: 100, output_tokens: 10 },
                  },
                };
                await tools.get(step.name)?.(step.args, {});
                continue;
              }
              yield {
                type: 'assistant',
                parent_tool_use_id: null,
                session_id: 'prov-1',
                message: {
                  content: [{ type: 'text', text: step.text }],
                  usage: { input_tokens: 100, output_tokens: 10 },
                },
              };
              // yield to the event loop so interrupts land between turns
              await new Promise((r) => setTimeout(r, 0));
            }
          }
          const generator = generate();
          return Object.assign(generator, {
            interrupt: async () => {
              interrupted = true;
            },
          });
        },
      };
      return createClaudeAgentSessionDriver({ sdk, pathToClaudeCodeExecutable: '/bin/claude' });
    },
  };
}

// ---------------------------------------------------------------------------
// shared harness
// ---------------------------------------------------------------------------

const outcomeSchema = z.object({ verdict: z.string() });

const probeTool = defineSessionTool({
  name: 'probe',
  description: 'probe a value',
  kind: 'probe',
  readOnly: true,
  destructive: false,
  inputSchema: z.object({ value: z.string() }),
  async execute(args) {
    return { content: `probed:${args.value}` };
  },
});

function makeDef(overrides?: Partial<SessionDef>): SessionDef {
  return {
    kind: 'conformance.case',
    systemPrompt: 'follow the scenario',
    tools: [probeTool],
    outcomeSchema,
    budget: { turns: 20, maxResumes: 0, tokenCeiling: 1_000_000 },
    ...overrides,
  };
}

function memoryPersistence() {
  const events = new Map<string, SessionEvent[]>();
  const index = new Map<string, SessionIndexEntry>();
  const persistence: SessionPersistence = {
    appendEvent(sessionId, event) {
      const list = events.get(sessionId) ?? [];
      list.push(event);
      events.set(sessionId, list);
    },
    updateIndex(entry) {
      index.set(entry.sessionId, entry);
    },
    readEvents(sessionId) {
      return events.get(sessionId) ?? [];
    },
  };
  return { persistence, events, index };
}

function loop(
  driver: SessionDriver,
  persistence: SessionPersistence,
  overrides?: Partial<AgentLoopInput<unknown>>,
) {
  return runAgentLoop({
    def: makeDef(),
    workItem: 'conformance/w',
    initialMessages: ['go'],
    driver,
    persistence,
    sessionId: 's1',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// ONE spec, both drivers
// ---------------------------------------------------------------------------

beforeEach(() => buildModelMock.mockReset());

for (const fixture of [apiFixture(), sdkFixture()]) {
  describe(`driver conformance: ${fixture.name}`, () => {
    it('completes a tool round-trip with a schema-valid outcome', async () => {
      const driver = fixture.make([
        { kind: 'text', text: 'thinking' },
        { kind: 'tool', name: 'probe', args: { value: 'hi' } },
        { kind: 'outcome', value: { verdict: 'keep' } },
      ]);
      const { persistence } = memoryPersistence();
      const outcome = await loop(driver, persistence).outcome;

      expect(outcome.status).toBe('completed');
      if (outcome.status !== 'completed') throw new Error('unreachable');
      expect(outcome.output).toEqual({ verdict: 'keep' });
      const types = persistence.readEvents('s1').map((e) => e.type);
      // Whatever the mechanics, the shared transcript shape holds: a start,
      // the opening message, deliberation and tool turns, the tool result,
      // and a terminal outcome — in that order.
      expect(types[0]).toBe('session-start');
      expect(types.at(-1)).toBe('outcome');
      const turnIdx = types.indexOf('assistant-turn');
      const toolResultIdx = types.indexOf('tool-result');
      expect(turnIdx).toBeGreaterThan(types.indexOf('user-message'));
      expect(toolResultIdx).toBeGreaterThan(turnIdx);
      // Text-only deliberation was legal in both drivers: no re-asks.
      expect(types).not.toContain('re-ask');
    });

    it('stops at the turn budget with the budget-exhausted failure', async () => {
      const driver = fixture.make([]); // never converges: endless text turns
      const { persistence } = memoryPersistence();
      const outcome = await loop(driver, persistence, {
        def: makeDef({ budget: { turns: 3, maxResumes: 0, tokenCeiling: 1_000_000 } }),
      }).outcome;

      expect(outcome.status).toBe('failed');
      if (outcome.status !== 'failed') throw new Error('unreachable');
      expect(outcome.failure).toMatchObject({ kind: 'budget-exhausted', notReached: 'conformance/w' });
      expect(outcome.resumable).toBe(true);
      expect(outcome.spent.turns).toBe(3);
    });

    it('grants fresh budgets automatically up to maxResumes', async () => {
      const driver = fixture.make([
        { kind: 'text', text: 'one' },
        { kind: 'text', text: 'two' },
        { kind: 'text', text: 'three' },
        { kind: 'outcome', value: { verdict: 'made it' } },
      ]);
      const { persistence } = memoryPersistence();
      const outcome = await loop(driver, persistence, {
        def: makeDef({ budget: { turns: 2, maxResumes: 1, tokenCeiling: 1_000_000 } }),
      }).outcome;

      expect(outcome.status).toBe('completed');
      expect(persistence.readEvents('s1').filter((e) => e.type === 'resume-grant')).toHaveLength(1);
    });

    it('records a steer as a user message before the turns that follow it', async () => {
      const driver = fixture.make([
        { kind: 'text', text: 'first' },
        { kind: 'await-user' },
        { kind: 'text', text: 'after steer' },
        { kind: 'outcome', value: { verdict: 'keep' } },
      ]);
      const { persistence } = memoryPersistence();
      const handle = loop(driver, persistence);
      // Steer once the first turn lands.
      const waitForTurn = async () => {
        while (!persistence.readEvents('s1').some((e) => e.type === 'assistant-turn')) {
          await new Promise((r) => setTimeout(r, 0));
        }
      };
      await waitForTurn();
      handle.steer('change course');
      const outcome = await handle.outcome;

      expect(outcome.status).toBe('completed');
      const events = persistence.readEvents('s1');
      const steerIdx = events.findIndex(
        (e) => e.type === 'user-message' && e.content === 'change course',
      );
      const firstTurnIdx = events.findIndex((e) => e.type === 'assistant-turn');
      const lastTurnIdx = events.map((e) => e.type).lastIndexOf('assistant-turn');
      expect(steerIdx).toBeGreaterThan(firstTurnIdx);
      expect(steerIdx).toBeLessThan(lastTurnIdx);
    });

    it('fails malformed when the outcome value violates the outcome schema', async () => {
      const driver = fixture.make([{ kind: 'outcome', value: { wrong: true } }]);
      const { persistence } = memoryPersistence();
      const outcome = await loop(driver, persistence).outcome;

      expect(outcome.status).toBe('failed');
      if (outcome.status !== 'failed') throw new Error('unreachable');
      expect(outcome.failure.kind).toBe('malformed');
      expect(outcome.resumable).toBe(true);
    });

    it('resumes a budget-exhausted session to completion on a fresh grant', async () => {
      const { persistence, index } = memoryPersistence();
      const first = await loop(
        fixture.make([]),
        persistence,
        { def: makeDef({ budget: { turns: 2, maxResumes: 0, tokenCeiling: 1_000_000 } }) },
      ).outcome;
      expect(first.status).toBe('failed');
      if (first.status !== 'failed') throw new Error('unreachable');
      expect(first.failure.kind).toBe('budget-exhausted');

      const second = await loop(fixture.make([{ kind: 'outcome', value: { verdict: 'resumed' } }]), persistence, {
        sessionId: 's2',
        initialMessages: ['carry on'],
        resume: { of: 's1', cursor: index.get('s1')?.resumeCursor },
      }).outcome;

      expect(second.status).toBe('completed');
      if (second.status !== 'completed') throw new Error('unreachable');
      expect(second.output).toEqual({ verdict: 'resumed' });
      expect(persistence.readEvents('s2')[0]).toMatchObject({
        type: 'session-start',
        resumeOf: 's1',
      });
    });
  });
}
