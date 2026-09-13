/**
 * The fold from a run record plus its activity journal to the conversation the
 * page renders.
 *
 * THE RULE: nothing here is made up. Every string that reaches the reader is a
 * field of the journal, shown as it is, or the name of a field or an enum. No
 * narration, no phrasing per tool, no digest of a value into prose, no
 * fallback sentence. A transcript event becomes one line carrying its own
 * fields; the page decides how a field looks, never what it says.
 *
 * All this level does is ORDER and GROUP: messages in `seq` order inside a
 * paragraph, paragraphs contiguous in the order they first spoke (a pool
 * interleaves them in the journal), a worker's paragraph right after the one
 * that started it, and paragraphs under the step whose `sessionKinds` claims
 * their kind.
 */

import type {
  BudgetSpent,
  ChildLinkage,
  SessionEvent,
  SessionLlm,
  SessionStatus,
  TurnUsage,
  UserInputQuestion,
} from '@truecourse/agent-loop';
import type { ActivityEvent, ActivityProgress } from '@truecourse/shared/activity-stream';
import type { PublicSessionRun } from '@/lib/api';
import { displayBlocks, runChecklist, type StepStatus } from './run-model';
import type { ChatFinding } from './conversation-pieces';

/** A `key: value` pair of an event's own fields. */
export type DataField = { label: string; value: string };

export type ConversationLine = { key: string; seq: number; ts: string } & (
  | { kind: 'system'; systemPrompt: string; llm?: SessionLlm; toolNames: readonly string[]; resumeOf?: string }
  | { kind: 'user'; content: string; actor?: string }
  | {
      kind: 'assistant';
      text?: string;
      toolCall?: { name: string; args: string };
      model?: string;
      usage?: TurnUsage;
    }
  | { kind: 'tool'; toolName: string; content: string; isError: boolean }
  /** The outcome value in full; of its display blocks only findings render. */
  | { kind: 'outcome'; value: string; findings: ChatFinding[] }
  | { kind: 'failure'; fields: DataField[] }
  | { kind: 'question'; question: UserInputQuestion }
  | { kind: 'child'; phase: 'started' | 'completed'; child: ChildLinkage; status?: SessionStatus; spent?: BudgetSpent }
  /** An event with nothing but fields: a retry, a grant, a re-ask, an answer. */
  | { kind: 'data'; label: string; fields: DataField[] }
);

/** One paragraph: the messages of one inner session, contiguous. */
export interface SessionBlock {
  sessionId: string;
  kind: string;
  workItem: string;
  status: SessionStatus;
  /** The short human name of this kind of work, when the session stamped one at start. */
  title?: string;
  /** Set when another paragraph started this one; it renders right below it. */
  parentSessionId?: string;
  spent?: BudgetSpent;
  lines: ConversationLine[];
  /** The stream's own progress line, while the work is live. */
  live?: string;
}

export interface StepBlock {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
  /** What the step did, one line each, as the engine recorded it. */
  facts: string[];
  sessions: SessionBlock[];
}

export interface Conversation {
  error?: string;
  steps: StepBlock[];
}

/**
 * The freshest record: the journal carries a full snapshot every time the run
 * writes itself, so the newest one in the events beats whatever the caller was
 * handed. A journal with no snapshot leaves the caller's record standing.
 */
export function latestRunRecord(
  run: PublicSessionRun,
  events: readonly ActivityEvent[],
): PublicSessionRun {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === 'run') return event.run as PublicSessionRun;
  }
  return run;
}

export function foldConversation(
  run: PublicSessionRun,
  events: readonly ActivityEvent[],
  progress: ActivityProgress = {},
): Conversation {
  const record = latestRunRecord(run, events);

  // One bucket per paragraph, remembering the cursor it first spoke on: that is
  // its place in the conversation, whatever the interleaving.
  const buckets = new Map<string, { first: number; events: SessionEvent[] }>();
  for (const event of events) {
    if (event.kind !== 'session-event') continue;
    const bucket = buckets.get(event.sessionId);
    if (bucket) bucket.events.push(event.event);
    else buckets.set(event.sessionId, { first: event.cursor, events: [event.event] });
  }

  const index = new Map(record.sessions.map((s) => [s.sessionId, s]));
  const parentOf = new Map<string, string>();
  for (const [sessionId, bucket] of buckets) {
    for (const event of bucket.events) {
      if (event.type === 'child-session') parentOf.set(event.child.sessionId, sessionId);
    }
  }

  const ordered = [...buckets.entries()].sort((a, b) => a[1].first - b[1].first).map(([id]) => id);
  // A paragraph the index lists but the journal has not reached yet still gets
  // its block, so nothing the run claims to have done goes missing.
  for (const entry of record.sessions) if (!buckets.has(entry.sessionId)) ordered.push(entry.sessionId);

  const blocks = new Map<string, SessionBlock>();
  for (const sessionId of ordered) {
    const own = [...(buckets.get(sessionId)?.events ?? [])].sort((a, b) => a.seq - b.seq);
    const entry = index.get(sessionId);
    const start = own.find((e) => e.type === 'session-start');
    const parentSessionId = parentOf.get(sessionId);
    const spent = entry?.spent;
    const live = progress[sessionId];
    const title = entry?.title ?? (start?.type === 'session-start' ? titleOf(start.display) : undefined);
    blocks.set(sessionId, {
      sessionId,
      kind: entry?.kind ?? (start?.type === 'session-start' ? start.kind : ''),
      workItem: entry?.workItem ?? (start?.type === 'session-start' ? start.workItem : ''),
      status: entry?.status ?? derivedStatus(own),
      ...(title ? { title } : {}),
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(spent ? { spent } : {}),
      lines: own.map(toLine).filter((line): line is ConversationLine => line !== null),
      ...(live
        ? {
            live:
              live.kind === 'text'
                ? live.text
                : `${live.toolName} · ${Math.floor(live.elapsedSeconds)}s`,
          }
        : {}),
    });
  }

  // Children ride with the paragraph that started them, never on their own
  // kind's step: the reader's question is "who started this", and the answer is
  // one paragraph up.
  const childrenOf = new Map<string, SessionBlock[]>();
  const roots: SessionBlock[] = [];
  for (const sessionId of ordered) {
    const block = blocks.get(sessionId)!;
    const parent = block.parentSessionId;
    if (parent && blocks.has(parent)) {
      const kin = childrenOf.get(parent) ?? [];
      kin.push(block);
      childrenOf.set(parent, kin);
    } else roots.push(block);
  }
  const withKin = (block: SessionBlock): SessionBlock[] => [
    block,
    ...(childrenOf.get(block.sessionId) ?? []).flatMap(withKin),
  ];

  const items = runChecklist(record);
  const claimed = new Set<string>();
  const steps: StepBlock[] = [];
  for (const item of items) {
    const kinds = item.sessionKinds ?? [];
    for (const kind of kinds) claimed.add(kind);
    steps.push({
      key: item.key,
      label: item.label,
      status: item.status,
      ...(item.detail ? { detail: item.detail } : {}),
      facts: factsOf(item),
      sessions: roots.filter((b) => kinds.includes(b.kind)).flatMap(withKin),
    });
  }

  // A kind no step claims heads its own group, under the kind id itself, and a
  // run that declared no checklist at all is entirely this path.
  for (const kind of [...new Set(roots.map((b) => b.kind))]) {
    if (claimed.has(kind)) continue;
    const sessions = roots.filter((b) => b.kind === kind).flatMap(withKin);
    steps.push({ key: `kind:${kind}`, label: kind, status: kindStatus(sessions), facts: [], sessions });
  }

  return { ...(record.error ? { error: record.error.message } : {}), steps };
}

/** A checklist item's recorded facts: the strings under `facts`, read tolerantly since older records have none. */
function factsOf(item: object): string[] {
  const facts = (item as { facts?: unknown }).facts;
  return Array.isArray(facts) ? facts.filter((f): f is string => typeof f === 'string') : [];
}

/** The title a session stamped on its display at start, read tolerantly. */
function titleOf(display: unknown): string | undefined {
  const title = (display as { title?: unknown } | undefined)?.title;
  return typeof title === 'string' && title.trim() !== '' ? title : undefined;
}

// ---------------------------------------------------------------------------
// one event, one line
// ---------------------------------------------------------------------------

/** Fields of an event body that are envelope or already shown elsewhere. */
const ENVELOPE = new Set(['type', 'seq', 'ts', 'raw']);

function toLine(event: SessionEvent): ConversationLine | null {
  const at = { key: `${event.seq}:${event.type}`, seq: event.seq, ts: event.ts };
  switch (event.type) {
    case 'session-start':
      return {
        ...at,
        kind: 'system',
        systemPrompt: event.systemPrompt,
        ...(event.llm ? { llm: event.llm } : {}),
        toolNames: event.toolNames,
        ...(event.resumeOf ? { resumeOf: event.resumeOf } : {}),
      };
    case 'user-message':
      return { ...at, kind: 'user', content: event.content, ...(event.actor ? { actor: event.actor } : {}) };
    case 'assistant-turn':
      return {
        ...at,
        kind: 'assistant',
        ...(event.text ? { text: event.text } : {}),
        ...(event.toolCall
          ? { toolCall: { name: event.toolCall.name, args: pretty(event.toolCall.args) } }
          : {}),
        ...(event.model ? { model: event.model } : {}),
        ...(event.usage ? { usage: event.usage } : {}),
      };
    case 'tool-result':
      return {
        ...at,
        kind: 'tool',
        toolName: event.toolName,
        content: event.content,
        isError: event.isError === true,
      };
    case 'outcome':
      return { ...at, kind: 'outcome', value: pretty(event.value), findings: findingsOf(event.display) };
    case 'failure':
      return { ...at, kind: 'failure', fields: fieldsOf(event.failure) };
    case 'question-asked':
      return { ...at, kind: 'question', question: event.question };
    case 'child-session':
      return {
        ...at,
        kind: 'child',
        phase: event.phase,
        child: event.child,
        ...(event.status ? { status: event.status } : {}),
        ...(event.spent ? { spent: event.spent } : {}),
      };
    case 'question-resolved':
    case 'provider-retry':
    case 'resume-grant':
    case 're-ask':
      return { ...at, kind: 'data', label: event.type, fields: fieldsOf(event) };
  }
}

/** The finding blocks of an outcome's display; checklist blocks are dropped. */
function findingsOf(display: unknown): ChatFinding[] {
  const findings: ChatFinding[] = [];
  for (const block of displayBlocks(display)) {
    if (block.kind !== 'finding') continue;
    const { claim, quotes, recommendation, dispute } = block as Record<string, unknown>;
    if (typeof claim !== 'string' || !Array.isArray(quotes)) continue;
    findings.push({
      claim,
      quotes: quotes as ChatFinding['quotes'],
      ...(recommendation ? { recommendation: recommendation as ChatFinding['recommendation'] } : {}),
      ...(dispute ? { dispute: dispute as ChatFinding['dispute'] } : {}),
    });
  }
  return findings;
}

/** An object's own fields as `label: value`, the envelope left out. */
function fieldsOf(value: unknown): DataField[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value)
    .filter(([label]) => !ENVELOPE.has(label))
    .map(([label, v]) => ({ label, value: typeof v === 'string' ? v : pretty(v) }));
}

function pretty(value: unknown): string {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** What the events themselves say happened, for a paragraph the index misses. */
function derivedStatus(events: readonly SessionEvent[]): SessionStatus {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'outcome') return 'completed';
    if (events[i].type === 'failure') return 'failed';
  }
  return 'running';
}

function kindStatus(sessions: readonly SessionBlock[]): StepStatus {
  if (sessions.some((s) => s.status === 'failed')) return 'error';
  if (sessions.some((s) => s.status === 'running' || s.status === 'waiting' || s.status === 'parked'))
    return 'active';
  return sessions.length === 0 ? 'pending' : 'done';
}
