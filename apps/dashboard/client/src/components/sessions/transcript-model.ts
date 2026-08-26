/**
 * The pure fold from persisted `SessionEvent`s (agent-loop's transcript
 * shapes) to CHAT rows — the session rendered as a conversation between the
 * AGENT (left) and the person watching (right). Machinery never renders: the
 * system prompt, orchestrator user-messages and budget bookkeeping are
 * dropped; instead the agent "speaks" its own progress — the intro line and
 * tool wording IT declared, its outcome blocks as finding cards and narration,
 * questions asked in-chat, and a closing Done message with the facts in words.
 * The only right-side voice is a real person: their question answers, and any
 * `user-message` carrying an `actor`. Snapshot + live-pushed events merge
 * here, deduped by `seq`.
 *
 * NOTHING here knows a session kind or a tool name. Copy is stamped into the
 * transcript by the session's own definition, so a new kind renders with zero
 * changes here; a transcript that declares nothing degrades to generic
 * phrasing and key/value facts.
 */

import type {
  DisplayDispute,
  OutcomeBlock,
  SessionDisplay,
  SessionEvent,
  UserInputQuestion,
} from '@truecourse/agent-loop';

/** One call inside a did-bubble — the step's expandable detail. */
export interface ActionCall {
  /** What the call targeted, humanized from its args. */
  target: string;
  ok?: boolean;
  duration?: string;
  /** The raw result content — the deepest drill level. */
  detail: string;
}

/**
 * The dispute identity of a finding — the SAME key `conflictResolutions`
 * entries carry (unordered doc pair + per-side section anchor + verbatim
 * quote), so a verdict recorded from the chat matches the corpus conflict.
 * Full repo-relative paths; the display layer shortens separately.
 */
export type FindingDispute = DisplayDispute;

/** The chat's result card — a `finding` block as the view consumes it. */
export type ChatFinding = Omit<Extract<OutcomeBlock, { kind: 'finding' }>, 'kind'>;

export type ChatRow =
  /** The agent talking: narration text or the synthesized intro. */
  | { seq: number; sub?: number; kind: 'agent-text'; text: string }
  /** A did-bubble: one run of the SAME tool, phrased as a sentence, its
   *  per-call detail carried for the in-bubble expand. */
  | {
      seq: number;
      sub?: number;
      kind: 'action';
      phrase: string;
      duration?: string;
      inFlight: boolean;
      calls: ActionCall[];
    }
  /** The watching person: an answer they gave, or an actor-labelled message. */
  | { seq: number; sub?: number; kind: 'user'; label?: string; text: string }
  | {
      seq: number;
      sub?: number;
      kind: 'question';
      question: UserInputQuestion;
      answer?: string;
      resolvedBy?: 'user' | 'policy';
    }
  | { seq: number; sub?: number; kind: 'finding'; finding: ChatFinding }
  /** The closing message: Done / a failure, with its facts in words. */
  | { seq: number; sub?: number; kind: 'close'; tone: 'ok' | 'fail'; headline: string; facts: string[] }
  | { seq: number; sub?: number; kind: 'note'; text: string; tone?: 'warn' };

type ActionRow = Extract<ChatRow, { kind: 'action' }>;

/** Merge the REST snapshot with the socket-pushed tail, deduped by `seq`. */
export function mergeEvents(
  snapshot: readonly SessionEvent[],
  live: readonly SessionEvent[],
): SessionEvent[] {
  const seen = new Set(snapshot.map((e) => e.seq));
  const merged = [...snapshot];
  for (const event of live) {
    if (seen.has(event.seq)) continue;
    seen.add(event.seq);
    merged.push(event);
  }
  return merged.sort((a, b) => a.seq - b.seq);
}

/** The session's granted turn budget, when a `resume-grant` revealed it. */
export function grantSize(events: readonly SessionEvent[]): number | undefined {
  for (const event of events) {
    if (event.type === 'resume-grant') return event.of;
  }
  return undefined;
}

export function toChatRows(events: readonly SessionEvent[]): ChatRow[] {
  const rows: ChatRow[] = [];
  // The open run of one tool — a different tool, a reply, or any other row
  // starts a fresh did-bubble. Held as a property (not a bare `let`) because
  // only the closures below assign it, and TS's CFA would otherwise pin the
  // narrowing to the initializer's `null`.
  const open: { action: { row: ActionRow; tool: string; firstTs: string } | null } = {
    action: null,
  };
  /** The call awaiting its `tool-result` (at most one — turns alternate). */
  let pending: { call: ActionCall; ts: string } | null = null;
  /** What the session said about itself on `session-start`, when it said
   *  anything: its intro line and per-tool wording. */
  let display: SessionDisplay | undefined;
  const questionRows = new Map<string, Extract<ChatRow, { kind: 'question' }>>();

  const push = (row: ChatRow): void => {
    rows.push(row);
    open.action = null;
  };

  for (const event of events) {
    switch (event.type) {
      case 'session-start':
        display = event.display;
        push({
          seq: event.seq,
          kind: 'agent-text',
          text: display?.intro ?? `I'm getting started on ${event.workItem}.`,
        });
        break;
      case 'user-message':
        // Actor-less messages are orchestrator-injected (briefing, budget
        // steer) — machinery, dropped. A real person carries `actor`.
        if (event.actor) push({ seq: event.seq, kind: 'user', label: event.actor, text: event.content });
        break;
      case 'assistant-turn': {
        if (event.text) push({ seq: event.seq, kind: 'agent-text', text: event.text });
        // The reserved `outcome` tool is the TRANSPORT of the result (api-mode
        // sessions deliver their outcome by calling it) — never a step.
        if (event.toolCall && event.toolCall.name !== 'outcome') {
          const tool = event.toolCall.name;
          if (!open.action || open.action.tool !== tool) {
            const row: ActionRow = { seq: event.seq, kind: 'action', phrase: '', inFlight: true, calls: [] };
            rows.push(row);
            open.action = { row, tool, firstTs: event.ts };
          }
          const call: ActionCall = { target: targetOf(event.toolCall.args), detail: '' };
          open.action.row.calls.push(call);
          open.action.row.phrase = toolPhrase(display, tool, open.action.row.calls.length);
          open.action.row.inFlight = true;
          pending = { call, ts: event.ts };
        }
        break;
      }
      case 'tool-result': {
        // Only a result with a matching pending call touches the open bubble;
        // the reserved `outcome` tool's ack (and any orphan) has none.
        if (pending) {
          pending.call.ok = event.isError !== true;
          pending.call.detail = event.content;
          const callTime = tsDelta(pending.ts, event.ts);
          if (callTime) pending.call.duration = callTime;
          pending = null;
          if (open.action) {
            open.action.row.inFlight = false;
            const total = tsDelta(open.action.firstTs, event.ts);
            if (total) open.action.row.duration = total;
          }
        }
        break;
      }
      case 'question-asked': {
        const row: Extract<ChatRow, { kind: 'question' }> = {
          seq: event.seq,
          kind: 'question',
          question: event.question,
        };
        push(row);
        if (event.question.id) questionRows.set(event.question.id, row);
        break;
      }
      case 'question-resolved': {
        const row = questionRows.get(event.questionId);
        const answer = describeAnswer(event.answer);
        if (row) {
          row.answer = answer;
          row.resolvedBy = event.resolvedBy;
        }
        if (event.resolvedBy === 'user') {
          push({ seq: event.seq, kind: 'user', text: answer });
        } else {
          push({ seq: event.seq, kind: 'note', text: `No answer arrived, so the run went ahead with ${answer}` });
        }
        break;
      }
      case 'outcome': {
        // The session's own rendering when it stamped one; otherwise the
        // generic key/value digest, which is what a transcript written before
        // presentation existed — or by a def that presents nothing — degrades
        // to. `displayError` is deliberately never shown. The Array.isArray
        // guard holds the never-crash contract against a malformed `display`
        // on a tailed transcript line — nothing on the read path validates it.
        const { rows: outcomeRows, facts } = Array.isArray(event.display?.blocks)
          ? foldBlocks(event.display.blocks, event.seq)
          : { rows: [], facts: digestOutcome(event.value) };
        for (const row of outcomeRows) push(row);
        push({
          seq: event.seq,
          sub: outcomeRows.length,
          kind: 'close',
          tone: 'ok',
          headline: "All done here. Here's where things landed.",
          facts,
        });
        break;
      }
      case 'failure':
        push({
          seq: event.seq,
          kind: 'close',
          tone: 'fail',
          headline: describeFailureTitle(event.failure),
          facts: describeFailureLines(event.failure),
        });
        break;
      case 'provider-retry':
        push({
          seq: event.seq,
          kind: 'note',
          tone: 'warn',
          text: `The model provider is busy${event.status ? ` (HTTP ${event.status})` : ''}, retrying${event.delayMs > 0 ? ` in ${Math.round(event.delayMs / 1000)}s` : ''}`,
        });
        break;
      case 'child-session':
        push({
          seq: event.seq,
          kind: 'note',
          text:
            event.phase === 'started'
              ? `A worker started on ${event.child.workItem}`
              : `The worker finished ${event.child.workItem}${event.status && event.status !== 'completed' ? ` (${event.status})` : ''}`,
        });
        break;
      case 're-ask':
      case 'resume-grant':
        break; // budget/validity machinery, never shown
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// phrasing — the product-language layer over raw events
// ---------------------------------------------------------------------------

function toolPhrase(display: SessionDisplay | undefined, tool: string, n: number): string {
  const t = display?.tools?.[tool];
  if (t) return n === 1 ? t.one : t.many.replace('{n}', String(n));
  const humane = tool.replace(/[_-]/g, ' ');
  return n === 1 ? `I ran ${humane}` : `I ran ${humane} ${n} times`;
}

/**
 * What one call targeted, humanized from its args: a string arg is itself the
 * target; an object contributes its string-valued fields ("self-hosting/tips.mdx
 * · Base64 Environment Variable"); anything else falls back to compact JSON.
 */
function targetOf(args: unknown): string {
  if (args == null) return '';
  if (typeof args === 'string') return cap(args, 100);
  if (typeof args === 'object' && !Array.isArray(args)) {
    const strings = Object.values(args).filter((v): v is string => typeof v === 'string');
    if (strings.length > 0) return cap(strings.join(' · '), 100);
  }
  return cap(JSON.stringify(args), 100);
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}…` : text;
}

// ---------------------------------------------------------------------------
// outcome rendering — the session's own blocks, or a generic digest
// ---------------------------------------------------------------------------

const FACT_LINE_CAP = 8;

/**
 * The blocks a session stamped onto its outcome, as rows: a finding becomes a
 * card, prose becomes narration, and every `facts` line joins the closing
 * message. The vocabulary is append-only, so a kind this client has never
 * heard of still says what it carries — as a fact line, never a crash.
 */
function foldBlocks(
  blocks: readonly OutcomeBlock[],
  seq: number,
): { rows: ChatRow[]; facts: string[] } {
  const rows: ChatRow[] = [];
  const facts: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case 'text':
        rows.push({ seq, sub: rows.length, kind: 'agent-text', text: block.text });
        break;
      case 'facts':
        facts.push(...block.lines);
        break;
      case 'finding':
        rows.push({
          seq,
          sub: rows.length,
          kind: 'finding',
          finding: {
            claim: block.claim,
            quotes: block.quotes,
            ...(block.recommendation ? { recommendation: block.recommendation } : {}),
            ...(block.dispute ? { dispute: block.dispute } : {}),
          },
        });
        break;
      default:
        facts.push(unknownBlockLine(block));
    }
  }
  return { rows, facts };
}

/** A block kind that postdates this client, stated by its own fields. */
function unknownBlockLine(block: object): string {
  const record = block as Record<string, unknown>;
  const kind = humanKey(String(record.kind ?? 'result'));
  const parts = Object.entries(record)
    .filter(([key]) => key !== 'kind')
    .map(([key, value]) => `${humanKey(key)}: ${describeValue(value)}`);
  return parts.length > 0 ? `${kind} · ${parts.join(' · ')}` : kind;
}

/**
 * An outcome that stamped no rendering, in words: a string is its own lines,
 * anything else states its top-level fields as key/value facts. That is what a
 * transcript written before sessions described themselves degrades to — plain
 * phrasing, never raw JSON.
 */
function digestOutcome(value: unknown): string[] {
  if (typeof value === 'string') return value.split('\n').slice(0, FACT_LINE_CAP);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [String(Array.isArray(value) ? `${value.length} results` : value)];
  }
  return Object.entries(value)
    .map(([key, v]) => `${humanKey(key)}: ${describeValue(v)}`)
    .slice(0, FACT_LINE_CAP);
}


/** The last two path segments — enough to tell sibling docs apart. Exported
 *  for the view's resolve buttons, which name docs off the full dispute. */
export function shortDocRef(path: string): string {
  return basename(path);
}

/**
 * The shortest names that still tell a doc PAIR apart: last segments when they
 * differ ("environment.mdx" vs "storage.mdx" instead of repeating a shared
 * "configuration/" prefix), two segments when they collide, full paths last.
 */
export function distinctDocRefs(a: string, b: string): [string, string] {
  const last = (p: string): string => p.split('/').filter(Boolean).pop() ?? p;
  if (last(a) !== last(b)) return [last(a), last(b)];
  if (basename(a) !== basename(b)) return [basename(a), basename(b)];
  return [a, b];
}

/** The last two path segments — enough to tell sibling docs apart. */
function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || path;
}

/** `uncheckedPairs` → `unchecked pairs`. */
function humanKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

function describeValue(v: unknown): string {
  if (Array.isArray(v)) return String(v.length);
  if (v !== null && typeof v === 'object') return `${Object.keys(v).length} fields`;
  const text = String(v);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function tsDelta(from: string, to: string): string | undefined {
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function describeAnswer(answer: unknown): string {
  return typeof answer === 'string' ? answer : JSON.stringify(answer);
}

type SessionFailureLike = Extract<SessionEvent, { type: 'failure' }>['failure'];

function describeFailureTitle(failure: SessionFailureLike): string {
  switch (failure.kind) {
    case 'budget-exhausted':
      return 'Ran out of budget';
    case 'context-exhausted':
      return 'Ran out of context';
    case 'malformed':
      return 'Stopped — the session went wrong';
    case 'transport':
      return 'Stopped — the provider failed';
    case 'session-lost':
      return 'Stopped — the provider session is gone';
  }
}

function describeFailureLines(failure: SessionFailureLike): string[] {
  switch (failure.kind) {
    case 'budget-exhausted':
      return failure.notReached
        ? [`I didn't get to: ${failure.notReached}`]
        : ['My turn budget ran out before I could finish.'];
    case 'context-exhausted':
      return ['I ran out of room in my context before finishing.'];
    case 'malformed':
      return [failure.detail];
    case 'transport':
      return [`${failure.class}: ${failure.detail}`];
    case 'session-lost':
      return [`provider session ${failure.providerSessionId} is gone`];
  }
}
