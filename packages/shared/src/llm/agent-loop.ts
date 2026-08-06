/**
 * The owned agent loop: drives one agentic session over the transport's
 * turn seam (`LlmTurnFn`). Written once — turn budget, token ceiling, tool
 * dispatch, malformed-turn re-ask, transcript events — so both backends
 * (claude-code sessions, api native tool calling) share one behavior.
 *
 * The model acts through ACTIONS. A native backend (api) declares the tools
 * to the provider and replies with a structured tool call; a text backend
 * (claude-code) is instructed to end each reply with exactly one fenced JSON
 * action block. The loop normalizes both into: use a tool, or deliver the
 * final OUTCOME. A session cannot end without an outcome or an explicit
 * terminal status — "silently stranded" is not a state this loop has.
 */

import {
  extractJsonValue,
  type LlmToolDef,
  type LlmTurnFn,
  type LlmTurnMessage,
  type LlmTurnReply,
} from './transport.js';

/** A tool the loop can dispatch: definition + the engine-side implementation.
 *  `run` returns the serialized result the model reads; it should THROW only
 *  on engine bugs — an invalid input or a failed operation belongs in the
 *  returned text so the model can react to it. */
export interface AgentToolDef extends LlmToolDef {
  run: (args: unknown) => Promise<string>;
}

/** The session's final deliverable. `parse` validates + narrows the payload
 *  (throw with a readable message on mismatch — the loop re-asks with it). */
export interface AgentOutcomeDef<T> {
  /** Action name the model finishes with. Default `finish`. */
  name?: string;
  description: string;
  /** JSON-schema STRING for the outcome payload (see `jsonSchemaHint`). */
  schema: string;
  parse: (value: unknown) => T;
}

export interface AgentLoopBudget {
  /** Model calls (turns), re-asks included. */
  maxTurns: number;
  /** Ceiling on summed input+output tokens across turns; unset = none. */
  maxTotalTokens?: number;
}

/** Cumulative session usage, in the same buckets `StageUsage` tracks. */
export interface AgentLoopUsage {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
}

/** One transcript event. Emitted live, in order; JSONL-friendly. */
export type AgentLoopEvent =
  | { kind: 'init'; ts: string; system: string; user: string; tools: string[]; model?: string; resumed?: boolean }
  | { kind: 'reply'; ts: string; turn: number; text: string; toolCall?: { name: string; arguments: unknown }; usage?: LlmTurnReply['usage'] }
  | { kind: 'tool'; ts: string; turn: number; name: string; args: unknown; result: string; durationMs: number }
  | { kind: 'reask'; ts: string; turn: number; detail: string }
  | { kind: 'outcome'; ts: string; turn: number; outcome: unknown }
  | { kind: 'end'; ts: string; status: AgentLoopResult<unknown>['status']; turns: number; usage: AgentLoopUsage; detail?: string };

export interface AgentLoopOptions<T> {
  turn: LlmTurnFn;
  /** The session's system prompt. Text backends get the action protocol block
   *  appended; native backends get a one-line finish instruction. */
  system: string;
  /** The opening user message. */
  user: string;
  tools: AgentToolDef[];
  outcome: AgentOutcomeDef<T>;
  budget: AgentLoopBudget;
  stage?: string;
  subject?: string;
  model?: string;
  fallbackModel?: string;
  /** Per-turn wall-clock ceiling, passed to the transport. */
  timeoutMs?: number;
  /** Live transcript sink. Must not throw; the loop guards it anyway. */
  onEvent?: (ev: AgentLoopEvent) => void;
  /**
   * Continue a prior session instead of opening a fresh one: the transcript so
   * far (a previous result's `messages`) plus its session handle. `user` is
   * then the next observation the session wakes up to (a fidelity flag, a
   * confirmation failure). The budget is THIS run's own — the caller decides
   * how many further turns a resumed session deserves.
   */
  resume?: { messages: LlmTurnMessage[]; sessionId?: string };
}

export type AgentLoopResult<T> =
  /** The model delivered a valid outcome. */
  | { status: 'outcome'; outcome: T; usage: AgentLoopUsage; messages: LlmTurnMessage[] }
  /** Two consecutive replies carried no parsable action. */
  | { status: 'malformed'; detail: string; usage: AgentLoopUsage; messages: LlmTurnMessage[] }
  /** The turn budget ran out before an outcome. */
  | { status: 'turn-budget'; usage: AgentLoopUsage; messages: LlmTurnMessage[] }
  /** The token ceiling was crossed before an outcome. */
  | { status: 'token-budget'; usage: AgentLoopUsage; messages: LlmTurnMessage[] }
  /** The transport failed twice in a row (spawn/API error, timeout). */
  | { status: 'turn-error'; error: string; usage: AgentLoopUsage; messages: LlmTurnMessage[] };

export const DEFAULT_OUTCOME_NAME = 'finish';

const MAX_QUOTED_REPLY_CHARS = 600;

/**
 * The action protocol block appended to the system prompt for text backends.
 * Exported so prompt fingerprints can incorporate it.
 */
export function renderActionProtocol(tools: LlmToolDef[], outcome: AgentOutcomeDef<unknown>): string {
  const toolLines = tools
    .map((t) => `- ${t.name}: ${t.description}\n  args JSON schema: ${t.schema}`)
    .join('\n');
  return [
    '## Actions',
    '',
    'You act by ending every reply with exactly ONE fenced JSON action block.',
    'Everything before the block is your working notes; the block is the action.',
    '',
    'To use a tool:',
    '```json',
    '{"tool": "<tool-name>", "args": { ... }}',
    '```',
    '',
    'Tools:',
    toolLines || '- (none)',
    '',
    `To finish the session (${outcome.description}):`,
    '```json',
    '{"outcome": { ... }}',
    '```',
    `outcome JSON schema: ${outcome.schema}`,
    '',
    'Rules: exactly one action block per reply, nothing after it. A reply',
    'without a valid action block is an error and wastes a turn.',
  ].join('\n');
}

/** One line for native backends: the tools are declared to the provider, only
 *  the finish contract needs words. */
function renderNativeFinishNote(outcomeName: string): string {
  return `\n\nWhen you have reached your final result, call the \`${outcomeName}\` tool with the outcome object. Every session must end with a \`${outcomeName}\` call.`;
}

type ParsedAction =
  | { kind: 'tool'; name: string; args: unknown; id?: string }
  | { kind: 'outcome'; value: unknown }
  | { kind: 'malformed'; detail: string };

/** Parse a text reply's trailing action block. Accepts the last fenced JSON
 *  block, else the first balanced JSON value in the reply. */
function parseTextAction(text: string, toolNames: Set<string>, outcomeName: string): ParsedAction {
  const fences = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)];
  const candidate = fences.length ? fences[fences.length - 1]![1]! : extractJsonValue(text);
  let value: unknown;
  try {
    value = JSON.parse(extractJsonValue(candidate ?? ''));
  } catch {
    return { kind: 'malformed', detail: 'no parsable JSON action block found in the reply' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'malformed', detail: 'the action block must be a JSON object' };
  }
  const action = value as { tool?: unknown; args?: unknown; outcome?: unknown };
  if ('outcome' in action) return { kind: 'outcome', value: action.outcome };
  if (typeof action.tool === 'string') {
    if (action.tool === outcomeName) return { kind: 'outcome', value: action.args };
    if (!toolNames.has(action.tool)) {
      return {
        kind: 'malformed',
        detail: `unknown tool "${action.tool}" — available: ${[...toolNames].join(', ')} (or finish with {"outcome": ...})`,
      };
    }
    return { kind: 'tool', name: action.tool, args: action.args };
  }
  return {
    kind: 'malformed',
    detail: 'the action block must carry either {"tool": "<name>", "args": {...}} or {"outcome": {...}}',
  };
}

/** Normalize one reply into an action, native tool call preferred. */
function resolveAction(
  reply: LlmTurnReply,
  toolNames: Set<string>,
  outcomeName: string,
): ParsedAction {
  if (reply.toolCall) {
    if (reply.toolCall.name === outcomeName) return { kind: 'outcome', value: reply.toolCall.arguments };
    if (toolNames.has(reply.toolCall.name)) {
      return { kind: 'tool', name: reply.toolCall.name, args: reply.toolCall.arguments, id: reply.toolCall.id };
    }
    return { kind: 'malformed', detail: `unknown tool "${reply.toolCall.name}"` };
  }
  return parseTextAction(reply.text, toolNames, outcomeName);
}

function reaskText(detail: string, invalidReply: string): string {
  const quoted = invalidReply.slice(0, MAX_QUOTED_REPLY_CHARS);
  return [
    `Your last reply did not contain a valid action: ${detail}.`,
    'Reply again, ending with exactly one fenced JSON action block:',
    '{"tool": "<name>", "args": {...}} to use a tool, or {"outcome": {...}} to finish.',
    '',
    'Invalid reply (excerpt):',
    '"""',
    quoted,
    '"""',
  ].join('\n');
}

/**
 * Run one agentic session to a terminal status. Never throws for model or
 * transport behavior — every ending is a structured result; only engine bugs
 * (a tool `run` throwing unexpectedly is caught and fed back; a broken
 * outcome `parse` throwing is a re-ask) surface differently.
 */
export async function runAgentLoop<T>(opts: AgentLoopOptions<T>): Promise<AgentLoopResult<T>> {
  const outcomeName = opts.outcome.name ?? DEFAULT_OUTCOME_NAME;
  const native = opts.turn.nativeTools === true;
  const system = native
    ? opts.system + renderNativeFinishNote(outcomeName)
    : `${opts.system}\n\n${renderActionProtocol(opts.tools, opts.outcome)}`;
  const toolByName = new Map(opts.tools.map((t) => [t.name, t]));
  const toolNames = new Set(toolByName.keys());
  // Native backends get the outcome declared as one more tool; text backends
  // act through the protocol block instead.
  const wireTools: LlmToolDef[] = [
    ...opts.tools.map(({ name, description, schema }) => ({ name, description, schema })),
    ...(native
      ? [{ name: outcomeName, description: opts.outcome.description, schema: opts.outcome.schema }]
      : []),
  ];

  const messages: LlmTurnMessage[] = opts.resume
    ? [...opts.resume.messages, { role: 'user', text: opts.user }]
    : [{ role: 'user', text: opts.user }];
  const usage: AgentLoopUsage = {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    costUsd: 0,
  };
  let sessionId: string | undefined = opts.resume?.sessionId;
  let consecutiveMalformed = 0;

  const now = (): string => new Date().toISOString();
  const emit = (ev: AgentLoopEvent): void => {
    try {
      opts.onEvent?.(ev);
    } catch {
      /* the transcript must never break the session */
    }
  };
  const end = <S extends AgentLoopResult<T>>(result: S, detail?: string): S => {
    emit({ kind: 'end', ts: now(), status: result.status, turns: usage.turns, usage, detail });
    return result;
  };

  emit({
    kind: 'init',
    ts: now(),
    system,
    user: opts.user,
    tools: [...toolNames],
    model: opts.model,
    ...(opts.resume ? { resumed: true } : {}),
  });

  for (;;) {
    if (usage.turns >= opts.budget.maxTurns) {
      return end({ status: 'turn-budget', usage, messages });
    }
    if (opts.budget.maxTotalTokens !== undefined && usage.inputTokens + usage.outputTokens >= opts.budget.maxTotalTokens) {
      return end({ status: 'token-budget', usage, messages });
    }

    const req = {
      id: opts.subject ? `${opts.stage ?? 'agent'}:${opts.subject}:t${usage.turns + 1}` : undefined,
      stage: opts.stage,
      subject: opts.subject,
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system,
      messages,
      tools: wireTools,
      sessionId,
      timeoutMs: opts.timeoutMs,
    };
    let reply: LlmTurnReply;
    try {
      reply = await opts.turn(req);
    } catch (first) {
      // One retry per turn: a conversation shrugs off a lost call. The session
      // (when any) is unchanged by a failed spawn, so the same tail re-sends.
      try {
        reply = await opts.turn(req);
      } catch (second) {
        const error = second instanceof Error ? second.message : String(second);
        void first;
        return end({ status: 'turn-error', error, usage, messages }, error);
      }
    }
    usage.turns += 1;
    if (reply.usage) {
      usage.inputTokens += reply.usage.inputTokens;
      usage.outputTokens += reply.usage.outputTokens;
      usage.cacheReadTokens += reply.usage.cacheReadTokens;
      usage.cacheCreateTokens += reply.usage.cacheCreateTokens;
      usage.costUsd += reply.usage.costUsd;
    }
    sessionId = reply.sessionId ?? sessionId;
    emit({
      kind: 'reply',
      ts: now(),
      turn: usage.turns,
      text: reply.text,
      ...(reply.toolCall ? { toolCall: { name: reply.toolCall.name, arguments: reply.toolCall.arguments } } : {}),
      ...(reply.usage ? { usage: reply.usage } : {}),
    });
    messages.push({
      role: 'assistant',
      text: reply.text,
      ...(reply.toolCall ? { toolCall: reply.toolCall } : {}),
    });

    const action = resolveAction(reply, toolNames, outcomeName);

    if (action.kind === 'malformed') {
      consecutiveMalformed += 1;
      if (consecutiveMalformed >= 2) {
        return end({ status: 'malformed', detail: action.detail, usage, messages }, action.detail);
      }
      emit({ kind: 'reask', ts: now(), turn: usage.turns, detail: action.detail });
      messages.push({ role: 'user', text: reaskText(action.detail, reply.text) });
      continue;
    }

    if (action.kind === 'outcome') {
      let parsed: T;
      try {
        parsed = opts.outcome.parse(action.value);
      } catch (e) {
        const detail = `the outcome did not match its schema: ${e instanceof Error ? e.message : String(e)}`;
        consecutiveMalformed += 1;
        if (consecutiveMalformed >= 2) {
          return end({ status: 'malformed', detail, usage, messages }, detail);
        }
        emit({ kind: 'reask', ts: now(), turn: usage.turns, detail });
        messages.push({ role: 'user', text: reaskText(detail, reply.text) });
        continue;
      }
      consecutiveMalformed = 0;
      emit({ kind: 'outcome', ts: now(), turn: usage.turns, outcome: parsed });
      return end({ status: 'outcome', outcome: parsed, usage, messages });
    }

    consecutiveMalformed = 0;
    const tool = toolByName.get(action.name)!;
    const t0 = Date.now();
    let resultText: string;
    try {
      resultText = await tool.run(action.args);
    } catch (e) {
      // A thrown tool is still a conversation: the model reads the failure and
      // revises. Engine-side crash diagnostics ride the transcript.
      resultText = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
    }
    emit({
      kind: 'tool',
      ts: now(),
      turn: usage.turns,
      name: action.name,
      args: action.args,
      result: resultText,
      durationMs: Date.now() - t0,
    });
    // A native call's result rides the tool role (the provider matches it to
    // the call id); a text-parsed action has no provider-side call to answer,
    // so the result returns as a plain user message.
    if (action.id) {
      messages.push({
        role: 'tool',
        text: resultText,
        toolCallId: action.id,
        toolName: action.name,
      });
    } else {
      messages.push({ role: 'user', text: `${action.name} result:\n${resultText}` });
    }
  }
}
