import { describe, it, expect } from 'vitest';
import {
  runAgentLoop,
  renderActionProtocol,
  type AgentLoopEvent,
  type AgentLoopOptions,
  type AgentToolDef,
} from '../../packages/shared/src/llm/agent-loop.js';
import type {
  LlmTurnFn,
  LlmTurnReply,
  LlmTurnRequest,
} from '../../packages/shared/src/llm/transport.js';

type ScriptStep = LlmTurnReply | Error | ((req: LlmTurnRequest) => LlmTurnReply);

/** A scripted turn backend: each call consumes the next step. */
function scriptedTurn(
  steps: ScriptStep[],
  opts: { native?: boolean } = {},
): { turn: LlmTurnFn; requests: LlmTurnRequest[] } {
  const requests: LlmTurnRequest[] = [];
  let i = 0;
  const turn: LlmTurnFn = async (req) => {
    // Snapshot: the loop passes its LIVE message array (adapters read it
    // synchronously); assertions run after later turns mutated it.
    requests.push({ ...req, messages: [...req.messages] });
    const step = steps[i++];
    if (!step) throw new Error(`scripted turn exhausted after ${i - 1} steps`);
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step(req);
    return step;
  };
  if (opts.native) turn.nativeTools = true;
  return { turn, requests };
}

const usage1 = {
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  costUsd: 0.01,
};

function reply(text: string, extra: Partial<LlmTurnReply> = {}): LlmTurnReply {
  return { text, usage: usage1, ...extra };
}

const echoTool: AgentToolDef = {
  name: 'run_scenario',
  description: 'Run a scenario in the sandbox.',
  schema: JSON.stringify({ type: 'object', properties: { yaml: { type: 'string' } }, required: ['yaml'] }),
  run: async (args) => `ran: ${(args as { yaml: string }).yaml}`,
};

function baseOptions(
  turn: LlmTurnFn,
  overrides: Partial<AgentLoopOptions<{ ok: boolean }>> = {},
): AgentLoopOptions<{ ok: boolean }> {
  return {
    turn,
    system: 'You are a worker.',
    user: 'Do the thing.',
    tools: [echoTool],
    outcome: {
      description: 'the final verdict',
      schema: JSON.stringify({ type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }),
      parse: (v) => {
        if (!v || typeof v !== 'object' || typeof (v as { ok?: unknown }).ok !== 'boolean') {
          throw new Error('outcome must be {ok: boolean}');
        }
        return v as { ok: boolean };
      },
    },
    budget: { maxTurns: 8 },
    stage: 'guard.worker',
    subject: 'flow-1',
    ...overrides,
  };
}

const action = (obj: unknown): string => '```json\n' + JSON.stringify(obj) + '\n```';

describe('runAgentLoop — text action protocol', () => {
  it('converges: tool call, observation, then outcome', async () => {
    const { turn, requests } = scriptedTurn([
      reply('Trying the scenario.\n' + action({ tool: 'run_scenario', args: { yaml: 'v1' } })),
      reply('Looks good.\n' + action({ outcome: { ok: true } })),
    ]);
    const events: AgentLoopEvent[] = [];
    const result = await runAgentLoop(baseOptions(turn, { onEvent: (e) => events.push(e) }));

    expect(result.status).toBe('outcome');
    if (result.status !== 'outcome') return;
    expect(result.outcome).toEqual({ ok: true });
    expect(result.usage.turns).toBe(2);
    expect(result.usage.inputTokens).toBe(200);
    expect(result.usage.costUsd).toBeCloseTo(0.02);

    // Turn 2 received the tool result as a plain user message (text protocol
    // has no provider call id to answer).
    const turn2 = requests[1]!;
    const tail = turn2.messages[turn2.messages.length - 1]!;
    expect(tail.role).toBe('user');
    expect(tail.text).toContain('run_scenario result:');
    expect(tail.text).toContain('ran: v1');

    expect(events.map((e) => e.kind)).toEqual(['init', 'reply', 'tool', 'reply', 'outcome', 'end']);
  });

  it('appends the action protocol block to the system prompt', async () => {
    const { turn, requests } = scriptedTurn([reply(action({ outcome: { ok: true } }))]);
    await runAgentLoop(baseOptions(turn));
    expect(requests[0]!.system).toContain('## Actions');
    expect(requests[0]!.system).toContain('run_scenario');
    expect(requests[0]!.system).toContain('{"outcome": { ... }}');
  });

  it('threads the session id across turns', async () => {
    const { turn, requests } = scriptedTurn([
      reply(action({ tool: 'run_scenario', args: { yaml: 'x' } }), { sessionId: 'sess-1' }),
      reply(action({ outcome: { ok: true } }), { sessionId: 'sess-1' }),
    ]);
    await runAgentLoop(baseOptions(turn));
    expect(requests[0]!.sessionId).toBeUndefined();
    expect(requests[1]!.sessionId).toBe('sess-1');
  });

  it('re-asks once on a malformed reply and recovers', async () => {
    const { turn, requests } = scriptedTurn([
      reply('I think the answer is clear.'),
      reply(action({ outcome: { ok: false } })),
    ]);
    const events: AgentLoopEvent[] = [];
    const result = await runAgentLoop(baseOptions(turn, { onEvent: (e) => events.push(e) }));
    expect(result.status).toBe('outcome');
    expect(events.some((e) => e.kind === 'reask')).toBe(true);
    const reask = requests[1]!.messages[requests[1]!.messages.length - 1]!;
    expect(reask.role).toBe('user');
    expect(reask.text).toContain('did not contain a valid action');
    expect(reask.text).toContain('I think the answer is clear.');
  });

  it('ends malformed after two consecutive unparsable replies', async () => {
    const { turn } = scriptedTurn([reply('nope'), reply('still nope')]);
    const result = await runAgentLoop(baseOptions(turn));
    expect(result.status).toBe('malformed');
    if (result.status !== 'malformed') return;
    expect(result.usage.turns).toBe(2);
  });

  it('re-asks on an unknown tool name', async () => {
    const { turn } = scriptedTurn([
      reply(action({ tool: 'probe_help', args: {} })),
      reply(action({ outcome: { ok: true } })),
    ]);
    const result = await runAgentLoop(baseOptions(turn));
    expect(result.status).toBe('outcome');
  });

  it('re-asks when the outcome fails its schema, then accepts the fix', async () => {
    const { turn, requests } = scriptedTurn([
      reply(action({ outcome: { verdict: 'yes' } })),
      reply(action({ outcome: { ok: true } })),
    ]);
    const result = await runAgentLoop(baseOptions(turn));
    expect(result.status).toBe('outcome');
    const reask = requests[1]!.messages[requests[1]!.messages.length - 1]!;
    expect(reask.text).toContain('did not match its schema');
  });

  it('feeds a thrown tool back as a result the model can react to', async () => {
    const boom: AgentToolDef = {
      ...echoTool,
      run: async () => {
        throw new Error('sandbox exploded');
      },
    };
    const { turn, requests } = scriptedTurn([
      reply(action({ tool: 'run_scenario', args: { yaml: 'x' } })),
      reply(action({ outcome: { ok: false } })),
    ]);
    const result = await runAgentLoop(baseOptions(turn, { tools: [boom] }));
    expect(result.status).toBe('outcome');
    const tail = requests[1]!.messages[requests[1]!.messages.length - 1]!;
    expect(tail.text).toContain('Tool error: sandbox exploded');
  });

  it('accepts a bare fenced action even with surrounding prose and earlier JSON', async () => {
    const { turn } = scriptedTurn([
      reply(
        'Looking at {"some": "inline json"} first.\n' +
          action({ tool: 'run_scenario', args: { yaml: 'v' } }),
      ),
      reply(action({ outcome: { ok: true } })),
    ]);
    const result = await runAgentLoop(baseOptions(turn));
    expect(result.status).toBe('outcome');
  });
});

describe('runAgentLoop — budgets and failures', () => {
  it('ends turn-budget when maxTurns is reached without an outcome', async () => {
    const loopy = reply(action({ tool: 'run_scenario', args: { yaml: 'again' } }));
    const { turn } = scriptedTurn([loopy, loopy, loopy]);
    const result = await runAgentLoop(baseOptions(turn, { budget: { maxTurns: 3 } }));
    expect(result.status).toBe('turn-budget');
    if (result.status !== 'turn-budget') return;
    expect(result.usage.turns).toBe(3);
  });

  it('ends token-budget when the ceiling is crossed', async () => {
    const loopy = reply(action({ tool: 'run_scenario', args: { yaml: 'again' } }));
    const { turn } = scriptedTurn([loopy, loopy, loopy, loopy]);
    const result = await runAgentLoop(
      baseOptions(turn, { budget: { maxTurns: 10, maxTotalTokens: 220 } }),
    );
    // 110 tokens per turn: the ceiling trips before turn 3.
    expect(result.status).toBe('token-budget');
    if (result.status !== 'token-budget') return;
    expect(result.usage.turns).toBe(2);
  });

  it('retries a thrown turn once and continues', async () => {
    const { turn } = scriptedTurn([
      new Error('spawn failed'),
      reply(action({ outcome: { ok: true } })),
    ]);
    const result = await runAgentLoop(baseOptions(turn));
    expect(result.status).toBe('outcome');
    if (result.status !== 'outcome') return;
    expect(result.usage.turns).toBe(1);
  });

  it('ends turn-error after two consecutive transport failures', async () => {
    const { turn } = scriptedTurn([new Error('down'), new Error('still down')]);
    const result = await runAgentLoop(baseOptions(turn));
    expect(result.status).toBe('turn-error');
    if (result.status !== 'turn-error') return;
    expect(result.error).toBe('still down');
  });
});

describe('runAgentLoop — native tool calling', () => {
  it('dispatches native tool calls and finishes via the finish tool', async () => {
    const { turn, requests } = scriptedTurn(
      [
        reply('', { toolCall: { id: 'c1', name: 'run_scenario', arguments: { yaml: 'v1' } } }),
        reply('', { toolCall: { id: 'c2', name: 'finish', arguments: { ok: true } } }),
      ],
      { native: true },
    );
    const result = await runAgentLoop(baseOptions(turn));
    expect(result.status).toBe('outcome');
    if (result.status !== 'outcome') return;
    expect(result.outcome).toEqual({ ok: true });

    // Native mode: no text protocol block, and the outcome rides as a tool.
    expect(requests[0]!.system).not.toContain('## Actions');
    expect(requests[0]!.system).toContain('`finish` tool');
    expect(requests[0]!.tools.map((t) => t.name)).toEqual(['run_scenario', 'finish']);

    // The tool result answers the provider call id on the tool role.
    const tail = requests[1]!.messages[requests[1]!.messages.length - 1]!;
    expect(tail.role).toBe('tool');
    expect(tail.toolCallId).toBe('c1');
    expect(tail.toolName).toBe('run_scenario');
    expect(tail.text).toBe('ran: v1');
  });

  it('re-asks on an unknown native tool', async () => {
    const { turn } = scriptedTurn(
      [
        reply('', { toolCall: { id: 'c1', name: 'mystery', arguments: {} } }),
        reply('', { toolCall: { id: 'c2', name: 'finish', arguments: { ok: false } } }),
      ],
      { native: true },
    );
    const result = await runAgentLoop(baseOptions(turn));
    expect(result.status).toBe('outcome');
  });
});

describe('renderActionProtocol', () => {
  it('lists every tool with its schema and the outcome contract', () => {
    const text = renderActionProtocol([echoTool], {
      description: 'the verdict',
      schema: '{"type":"object"}',
      parse: (v) => v,
    });
    expect(text).toContain('run_scenario: Run a scenario in the sandbox.');
    expect(text).toContain('args JSON schema:');
    expect(text).toContain('To finish the session (the verdict):');
    expect(text).toContain('{"type":"object"}');
  });
});
