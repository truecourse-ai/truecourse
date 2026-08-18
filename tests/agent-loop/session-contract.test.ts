import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  SessionEventSchema,
  SessionEventBodySchema,
  SessionFailureSchema,
  RunRecordSchema,
  defineSessionTool,
  type SessionEvent,
  type ToolContext,
} from '../../packages/agent-loop/src/index';

const envelope = { seq: 0, ts: '2026-08-17T00:00:00.000Z' };
const usage = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  costUsd: 0.01,
  costSource: 'provider-reported' as const,
};

describe('session transcript events', () => {
  it('accepts every event type with the shell-stamped envelope', () => {
    const events: SessionEvent[] = [
      {
        ...envelope,
        type: 'session-start',
        kind: 'spec-scan.curation',
        workItem: 'docs/a.md',
        systemPrompt: 'you are…',
        toolNames: ['read-doc'],
      },
      {
        ...envelope,
        type: 'session-start',
        kind: 'spec-scan.curation',
        workItem: 'docs/a.md',
        systemPrompt: 'you are…',
        toolNames: ['read-doc'],
        llm: {
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          fallbackModel: 'claude-sonnet-4-6',
          endpoint: 'https://gateway.internal/v1',
        },
      },
      { ...envelope, type: 'user-message', content: 'skip the archive', actor: 'sarkis' },
      { ...envelope, type: 'assistant-turn', text: 'thinking it over', usage },
      {
        ...envelope,
        type: 'assistant-turn',
        text: 'served by the fallback',
        usage,
        model: 'claude-sonnet-4-6-20260101',
      },
      {
        ...envelope,
        type: 'provider-retry',
        attempt: 1,
        status: 429,
        message: 'rate limited',
        delayMs: 2000,
        model: 'claude-opus-4-6',
      },
      // A connection error never got a response: no status to report.
      {
        ...envelope,
        type: 'provider-retry',
        attempt: 2,
        message: 'socket hang up',
        delayMs: 0,
        model: 'claude-sonnet-4-6',
      },
      {
        ...envelope,
        type: 'assistant-turn',
        toolCall: { name: 'read-doc', args: { path: 'docs/a.md' } },
        usage,
      },
      { ...envelope, type: 'tool-result', toolName: 'read-doc', content: '# A' },
      {
        ...envelope,
        type: 'question-asked',
        question: {
          id: 'q1',
          header: 'Scope',
          question: 'Keep /archive?',
          options: [{ label: 'keep' }, { label: 'exclude', description: 'historical' }],
          multiSelect: false,
        },
      },
      { ...envelope, type: 'question-resolved', questionId: 'q1', answer: 'keep', resolvedBy: 'policy' },
      { ...envelope, type: 're-ask', invalid: '{"tool": "nope"}', reason: 'unknown tool' },
      { ...envelope, type: 'resume-grant', grant: 1, of: 2 },
      {
        ...envelope,
        type: 'child-session',
        phase: 'completed',
        child: { sessionId: 's2', kind: 'spec-scan.overlap', workItem: 'core/auth' },
        status: 'completed',
        spent: { turns: 3, tokens: 1200, costUsd: 0.2 },
      },
      { ...envelope, type: 'outcome', value: { keep: true } },
      {
        ...envelope,
        type: 'failure',
        failure: { kind: 'budget-exhausted', notReached: 'docs/b.md, docs/c.md', retryability: 'none' },
      },
    ];
    for (const event of events) {
      expect(SessionEventSchema.safeParse(event).success, event.type).toBe(true);
    }
  });

  it('carries the raw escape hatch without requiring it', () => {
    const parsed = SessionEventSchema.safeParse({
      ...envelope,
      type: 'tool-result',
      toolName: 'read-doc',
      content: 'x',
      raw: { source: 'claude.sdk.message', payload: { anything: true } },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown event type and a body without its envelope', () => {
    expect(
      SessionEventSchema.safeParse({ ...envelope, type: 'content.delta', text: 'hi' }).success,
    ).toBe(false);
    expect(
      SessionEventSchema.safeParse({ type: 'outcome', value: 1 }).success,
    ).toBe(false);
    // Drivers emit bodies — valid without seq/ts.
    expect(SessionEventBodySchema.safeParse({ type: 'outcome', value: 1 }).success).toBe(true);
  });

  it('keeps attribution optional and credential-free', () => {
    // A driver that declares nothing still produces a legal transcript.
    expect(
      SessionEventBodySchema.safeParse({
        type: 'session-start',
        kind: 'k',
        workItem: 'w',
        systemPrompt: 's',
        toolNames: [],
      }).success,
    ).toBe(true);
    // The schema is non-strict, so a key it does not declare is STRIPPED
    // rather than rejected — which is what keeps a leaked secret out of a
    // re-serialized transcript.
    const parsed = SessionEventBodySchema.parse({
      type: 'session-start',
      kind: 'k',
      workItem: 'w',
      systemPrompt: 's',
      toolNames: [],
      llm: { provider: 'anthropic', model: 'opus', apiKey: 'sk-leak' },
    });
    expect(parsed).toMatchObject({ llm: { provider: 'anthropic', model: 'opus' } });
    expect(JSON.stringify(parsed)).not.toContain('sk-leak');
  });

  it('rejects a provider-retry missing the fields a reader needs', () => {
    const good = {
      type: 'provider-retry' as const,
      attempt: 1,
      message: 'overloaded',
      delayMs: 1000,
      model: 'opus',
    };
    expect(SessionEventBodySchema.safeParse(good).success).toBe(true);
    // Which model, and how long the wait is, are the whole point of the event.
    expect(SessionEventBodySchema.safeParse({ ...good, model: undefined }).success).toBe(false);
    expect(SessionEventBodySchema.safeParse({ ...good, delayMs: undefined }).success).toBe(false);
    // Attempts are 1-based; a zeroth retry is not a thing.
    expect(SessionEventBodySchema.safeParse({ ...good, attempt: 0 }).success).toBe(false);
  });

  it('requires the retryability axis on every failure kind', () => {
    expect(
      SessionFailureSchema.safeParse({ kind: 'transport', detail: '429', class: 'provider' })
        .success,
    ).toBe(false);
    expect(
      SessionFailureSchema.safeParse({
        kind: 'transport',
        detail: '429',
        class: 'provider',
        retryability: 'transient',
      }).success,
    ).toBe(true);
  });
});

describe('run record', () => {
  it('round-trips a run with a parked session carrying an opaque cursor', () => {
    const run = {
      command: 'guard-generate',
      runId: '2026-08-17T00-00-00_abc123',
      gitRef: 'sm/agentic-pipeline-plan',
      startedAt: '2026-08-17T00:00:00.000Z',
      status: 'running',
      endpoint: { url: 'http://127.0.0.1:52341', token: 't' },
      sessions: [
        {
          sessionId: 's1',
          kind: 'guard-generate.author',
          workItem: 'flow:booking-lifecycle',
          status: 'parked',
          providerSessionId: '525d3377-aa14',
          resumeCursor: { providerSessionId: '525d3377-aa14', resumeSessionAt: 'uuid-7' },
          spent: { turns: 9, tokens: 40_000, costUsd: 1.1 },
        },
      ],
    };
    const parsed = RunRecordSchema.parse(run);
    expect(parsed.sessions[0].resumeCursor).toEqual(run.sessions[0].resumeCursor);
  });

  it('carries what the run ran on across a reopen', () => {
    const run = {
      command: 'guard-interfaces',
      runId: '2026-08-18T00-00-00Z_abc123',
      gitRef: 'abc',
      startedAt: '2026-08-18T00:00:00.000Z',
      status: 'completed',
      llm: {
        mode: 'api',
        provider: 'bedrock',
        model: 'eu.anthropic.claude-opus-4-6-v1:0',
        fallbackModel: 'eu.anthropic.claude-sonnet-4-6-v1:0',
      },
      sessions: [],
    };
    // The schema is non-strict — an undeclared key would be silently dropped
    // on reopen, which is exactly why `llm` has to be declared.
    expect(RunRecordSchema.parse(run).llm).toEqual(run.llm);
    // Optional: a run recorded before attribution existed still reopens.
    const { llm: _llm, ...older } = run;
    expect(RunRecordSchema.parse(older).llm).toBeUndefined();
  });
});

describe('defineSessionTool', () => {
  it('infers execute args from the input schema without casts', async () => {
    const tool = defineSessionTool({
      name: 'read-doc-section',
      description: 'Read one section of a doc',
      kind: 'read-doc-section',
      readOnly: true,
      destructive: false,
      inputSchema: z.object({ path: z.string(), heading: z.string().nullable() }),
      async execute(args) {
        // args is typed from the schema; exercising it proves the inference.
        return { content: `${args.path}#${args.heading ?? 'lead'}` };
      },
    });
    const result = await tool.execute(
      { path: 'docs/a.md', heading: null },
      { workItem: 'x', signal: new AbortController().signal } as ToolContext,
    );
    expect(result.content).toBe('docs/a.md#lead');
  });
});
