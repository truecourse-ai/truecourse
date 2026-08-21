/**
 * The pure fold from persisted `SessionEvent`s (agent-loop's transcript
 * shapes) to CHAT rows — the session rendered as a conversation between the
 * AGENT (left) and the person watching (right). Machinery never renders: the
 * system prompt, orchestrator user-messages and budget bookkeeping are
 * dropped; instead the agent "speaks" its own progress — a per-kind intro
 * line, tool work phrased as did-bubbles ("Read 35 sections · 58s") via
 * `TOOL_PHRASES`, findings extracted out of the outcome as cards, questions
 * asked in-chat, and a closing Done message with the facts in words. The only
 * right-side voice is a real person: their question answers, and any
 * `user-message` carrying an `actor`. Snapshot + live-pushed events merge
 * here, deduped by `seq`.
 */

import type { SessionEvent, UserInputQuestion } from '@truecourse/agent-loop';

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
export interface FindingDispute {
  docA: string;
  anchorA: string | null;
  quoteA?: string;
  docB: string;
  anchorB: string | null;
  quoteB?: string;
}

/** A finding lifted out of an outcome value — the chat's result card. */
export interface ChatFinding {
  /** What disagrees, in a sentence. */
  claim: string;
  /** Up to two quoted passages, side by side. */
  quotes: { doc: string; heading?: string; quote: string }[];
  recommendation?: { doc?: string; rationale: string; confidence?: string };
  /** Present when the finding names a resolvable two-doc dispute. */
  dispute?: FindingDispute;
}

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
  /** The session kind (from `session-start`) — keys the copy layer. */
  let sessionKind = '';
  const questionRows = new Map<string, Extract<ChatRow, { kind: 'question' }>>();

  const push = (row: ChatRow): void => {
    rows.push(row);
    open.action = null;
  };

  for (const event of events) {
    switch (event.type) {
      case 'session-start':
        sessionKind = event.kind;
        push({ seq: event.seq, kind: 'agent-text', text: kindIntro(event.kind, event.workItem) });
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
          open.action.row.phrase = toolPhrase(sessionKind, tool, open.action.row.calls.length);
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
        const { findings, facts } = digestOutcome(event.value);
        findings.forEach((finding, i) => push({ seq: event.seq, sub: i, kind: 'finding', finding }));
        push({
          seq: event.seq,
          sub: findings.length,
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

interface ToolPhrase {
  one: string;
  many: string;
}

/**
 * The per-kind copy layer: the agent's opening line plus purpose-bearing
 * did-bubble sentences for the tools whose PURPOSE depends on the session
 * (`doc_outline` in scan-scope is sampling for coverage; `read_section` in an
 * overlap review is collecting claims). Every phrase states what the session's
 * briefing actually asks for, never an invented motive. Keys are the real
 * `*_SESSION_KIND` constants; unknown kinds fall to the defaults below.
 */
const KIND_COPY: Record<string, { intro: (workItem: string) => string; tools?: Record<string, ToolPhrase> }> = {
  'spec-scan.orchestrate': {
    intro: () =>
      "Before the scan reads anything, I'm working out what it should cover. I'll look over the doc tree, sample a few outlines, and decide which folders are in and which are out.",
    tools: {
      list_universe: {
        one: 'I looked over the doc tree to see the folders and how many docs each holds',
        many: 'I looked over the doc tree {n} times, checking folders and doc counts',
      },
      doc_outline: {
        one: 'I skimmed one doc outline, sampling its folder before ruling anything in or out',
        many: 'I skimmed the outlines of {n} docs, sampling each folder before ruling anything in or out',
      },
    },
  },
  'spec-scan.overlap': {
    intro: (w) => `I'm reviewing ${w}, reading its docs side by side to catch any claims that disagree.`,
    tools: {
      read_section: {
        one: 'I read one section, collecting what the doc claims',
        many: 'I read through {n} sections, collecting what each doc claims',
      },
      read_doc_chunk: {
        one: 'I read a doc straight through where its outline was too thin to pick sections from',
        many: 'I read {n} doc chunks straight through where outlines were too thin',
      },
      check_findings: {
        one: 'I double-checked my findings against the docs before writing them down',
        many: 'I double-checked my findings against the docs, {n} passes',
      },
    },
  },
  'spec-scan.curate-doc': {
    intro: (w) => `I'm reading ${w} to decide whether it belongs in the corpus and which areas it covers.`,
    tools: {
      read_doc: { one: 'I read the doc in full', many: 'I read the doc in full, {n} passes' },
      read_chunk: { one: 'I read one chunk of the doc', many: 'I read {n} chunks of the doc' },
      corpus_vocab: {
        one: "I checked the corpus's area vocabulary so I reuse existing labels instead of minting new ones",
        many: "I checked the corpus's area vocabulary {n} times",
      },
      list_docs: {
        one: 'I looked over the docs already in the corpus',
        many: 'I looked over the docs already in the corpus {n} times',
      },
    },
  },
  'spec-scan.settle-areas': {
    intro: () => "I'm settling the area labels, merging synonyms so the corpus speaks one vocabulary.",
    tools: {
      docs_with_label: {
        one: 'I pulled up the docs behind one label to see whether it earns its own area',
        many: 'I pulled up the docs behind {n} labels to see whether each earns its own area',
      },
      check_settlement: {
        one: 'I checked my settlement against the corpus before committing it',
        many: 'I checked my settlement {n} times before committing it',
      },
    },
  },
  'guard-interfaces.web-tasks': {
    intro: (w) => `I'm writing the user tasks for ${w}, grounded in what its screens and code actually support.`,
    tools: {
      read_file: {
        one: 'I read one source file to see what this screen supports',
        many: 'I read through {n} source files to see what this screen supports',
      },
      search_repo: {
        one: 'I searched the code for how this screen behaves',
        many: 'I searched the code {n} times for how this screen behaves',
      },
      list_interfaces: {
        one: "I looked up the tasks that already exist so I don't duplicate one",
        many: "I looked up the tasks that already exist so I don't duplicate one",
      },
    },
  },
};

function kindIntro(kind: string, workItem: string): string {
  return (KIND_COPY[kind]?.intro ?? ((w: string) => `I'm getting started on ${w}.`))(workItem);
}

/** Kind-independent defaults for tools that read the same everywhere. */
const TOOL_PHRASES: Record<string, ToolPhrase> = {
  read_section: { one: 'I read one section of the docs', many: 'I read through {n} sections of the docs' },
  read_file: { one: 'I read one file', many: 'I read through {n} files' },
  search_repo: { one: 'I searched the codebase', many: 'I searched the codebase {n} times' },
  check_findings: { one: 'I double-checked my findings', many: 'I double-checked my findings, {n} passes' },
  check_draft: { one: 'I validated my draft against the catalog', many: 'I validated my draft {n} times' },
  list_places: { one: "I looked up the app's screens", many: "I looked up the app's screens" },
  list_interfaces: { one: 'I looked up the tasks that already exist', many: 'I looked up the tasks that already exist' },
};

function toolPhrase(kind: string, tool: string, n: number): string {
  const t = KIND_COPY[kind]?.tools?.[tool] ?? TOOL_PHRASES[tool];
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
// outcome digestion — findings out, facts in words
// ---------------------------------------------------------------------------

const FACT_LINE_CAP = 8;

/**
 * Lift findings and facts out of an outcome value. Shape-driven, not
 * kind-driven: any outcome carrying an `overlaps` array of {note, sections,
 * review} entries yields finding cards (the spec-scan overlap shape); every
 * other top-level field becomes a plain-language fact line. Unknown shapes
 * degrade to facts alone — never to raw JSON.
 */
function digestOutcome(value: unknown): { findings: ChatFinding[]; facts: string[] } {
  if (typeof value === 'string') {
    return { findings: [], facts: value.split('\n').slice(0, FACT_LINE_CAP) };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { findings: [], facts: [String(Array.isArray(value) ? `${value.length} results` : value)] };
  }
  const record = value as Record<string, unknown>;
  const scopeFacts = digestScope(record);
  if (scopeFacts) return { findings: [], facts: scopeFacts.slice(0, FACT_LINE_CAP) };
  const findings = Array.isArray(record.overlaps)
    ? record.overlaps.map(toFinding).filter((f): f is ChatFinding => f !== null)
    : [];
  const facts: string[] = [];
  for (const [key, v] of Object.entries(record)) {
    if (key === 'overlaps' && findings.length > 0) {
      facts.push(`${findings.length} finding${findings.length === 1 ? '' : 's'} recorded`);
      continue;
    }
    facts.push(`${humanKey(key)}: ${describeValue(v)}`);
  }
  return { findings, facts: facts.slice(0, FACT_LINE_CAP) };
}

/**
 * The scan-scope outcome shape (`verdicts` of keep/exclude subtree calls +
 * `instructions`), digested into words: what stayed in scope, what was left
 * out and WHY (the verdict entries carry real reason strings), and whether the
 * scan sessions got standing instructions. Null when the shape doesn't hold.
 */
function digestScope(record: Record<string, unknown>): string[] | null {
  if (!Array.isArray(record.verdicts) || !Array.isArray(record.instructions)) return null;
  const verdicts = record.verdicts.filter(
    (v): v is { path: string; verdict: string; reason?: string } =>
      v !== null && typeof v === 'object' && typeof (v as Record<string, unknown>).path === 'string' &&
      ((v as Record<string, unknown>).verdict === 'keep' || (v as Record<string, unknown>).verdict === 'exclude'),
  );
  if (verdicts.length === 0) return null;
  const excluded = verdicts.filter((v) => v.verdict === 'exclude');
  const kept = verdicts.length - excluded.length;
  const facts = [
    `I set the scan's scope: ${kept} of ${verdicts.length} doc subtrees kept${excluded.length === 0 ? ', nothing left out' : ''}`,
  ];
  for (const v of excluded) {
    facts.push(`left out ${v.path}${typeof v.reason === 'string' && v.reason ? `: ${v.reason}` : ''}`);
  }
  const instructions = record.instructions.filter((i): i is string => typeof i === 'string');
  if (instructions.length === 0) facts.push('no extra instructions for the scan sessions');
  else for (const i of instructions) facts.push(`instruction for the scan: ${i}`);
  return facts;
}

/** One overlap entry → a card, or null when the shape doesn't hold. */
function toFinding(entry: unknown): ChatFinding | null {
  if (entry === null || typeof entry !== 'object') return null;
  const o = entry as Record<string, unknown>;
  if (typeof o.note !== 'string') return null;
  const docs = Array.isArray(o.docs) ? o.docs.filter((d): d is string => typeof d === 'string') : [];
  const sections = Array.isArray(o.sections) ? o.sections : [];
  const quotes = sections
    .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
    .filter((s) => typeof s.quote === 'string')
    .slice(0, 2)
    .map((s) => ({
      doc: basename(typeof s.doc === 'string' ? s.doc : ''),
      heading: typeof s.heading === 'string' ? s.heading : undefined,
      quote: s.quote as string,
    }));
  const review =
    o.review !== null && typeof o.review === 'object' ? (o.review as Record<string, unknown>) : undefined;
  const rec =
    review?.recommendation !== null && typeof review?.recommendation === 'object'
      ? (review.recommendation as Record<string, unknown>)
      : undefined;
  const recommendation = rec
    ? {
        doc: recommendedDoc(typeof rec.action === 'string' ? rec.action : undefined, docs),
        rationale: typeof rec.rationale === 'string' ? rec.rationale : '',
        confidence: typeof rec.confidence === 'string' ? rec.confidence : undefined,
      }
    : undefined;
  return { claim: o.note, quotes, recommendation, ...disputeOf(docs, sections) };
}

/**
 * The dispute identity, when the entry names exactly two docs: full paths,
 * each side's section heading (null = preamble, or no section captured for
 * that doc) and verbatim quote — the key `postSpecConflictResolution` takes.
 */
function disputeOf(docs: string[], sections: unknown[]): { dispute?: FindingDispute } {
  if (docs.length !== 2) return {};
  const side = (doc: string): { anchor: string | null; quote?: string } => {
    const section = sections
      .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
      .find((s) => s.doc === doc);
    return {
      anchor: typeof section?.heading === 'string' ? section.heading : null,
      ...(typeof section?.quote === 'string' ? { quote: section.quote } : {}),
    };
  };
  const a = side(docs[0]);
  const b = side(docs[1]);
  return {
    dispute: {
      docA: docs[0],
      anchorA: a.anchor,
      ...(a.quote !== undefined ? { quoteA: a.quote } : {}),
      docB: docs[1],
      anchorB: b.anchor,
      ...(b.quote !== undefined ? { quoteB: b.quote } : {}),
    },
  };
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

/** `pick-a`/`pick-b` name a side of the pair; anything else names no doc. */
function recommendedDoc(action: string | undefined, docs: string[]): string | undefined {
  if (action === 'pick-a' && docs[0]) return basename(docs[0]);
  if (action === 'pick-b' && docs[1]) return basename(docs[1]);
  return undefined;
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
