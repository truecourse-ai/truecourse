/**
 * One conversation: the run's work as a list, and the selected piece of
 * work as its transcript beside it.
 *
 * A run does several things at once (a pool of workers, each with a child of
 * its own), so a single column that keeps each piece of work together has to
 * grow in several places at once. Instead the left column is the LIST of the
 * work: the run's steps as headings, one row per piece of work with a status
 * dot (pulsing while it runs), its title and how long it took. The list only
 * ever gains rows and changes dots. Clicking a row opens that work's
 * transcript on the right, whole and verbatim, following its end while it
 * runs. The selection lives in the address (`?work=`).
 *
 * NOTHING HERE IS WRITTEN BY THIS PAGE. A row's title is the first line of
 * the briefing the work was given; every message in the transcript is the
 * event that was recorded, whole. What this file chooses is how a field
 * LOOKS, never what it says.
 *
 * The page is HEADERLESS: whoever mounts it owns the header row.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUp, X } from 'lucide-react';
import type { SessionStatus } from '@truecourse/agent-loop';
import type { PublicSessionRun } from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { FindingCard, FindingResolveProvider } from './conversation-pieces';
import { STEP_DOT, formatDuration } from './run-model';
import { useRunConversation } from './useRunConversation';
import type { ConversationLine, DataField, SessionBlock, StepBlock } from './conversation-model';

const EMPTY_STEPS: readonly StepBlock[] = [];

/** The reading column: wide enough for a quoted diff, narrow enough to read. */
const COLUMN = 'mx-auto w-[780px] max-w-full';

/** The dot a piece of work wears: grey and pulsing while it runs, green when done, red when failed, amber while it waits. */
const WORK_DOT: Record<SessionStatus, string> = {
  running: 'bg-muted-foreground/60 animate-pulse',
  waiting: 'bg-amber-500',
  parked: 'bg-amber-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
};

export function RunConversationPage({ run, repoId }: { run: PublicSessionRun; repoId: string }) {
  const { conversation, loading, error, connectionError } = useRunConversation(run, repoId);
  // History lands page by page; painting it as it comes shows every row before
  // its lines, so the page waits for the whole of it and paints once.
  const steps = loading ? EMPTY_STEPS : conversation.steps;

  const [params, setParams] = useSearchParams();
  const selectedId = params.get('work');
  const blocks = useMemo(() => {
    const map = new Map<string, SessionBlock>();
    for (const step of steps) for (const block of step.sessions) map.set(block.sessionId, block);
    return map;
  }, [steps]);
  const selected = selectedId ? blocks.get(selectedId) : undefined;
  const select = useCallback(
    (sessionId: string | null) => {
      const next = new URLSearchParams(params);
      if (sessionId) next.set('work', sessionId);
      else next.delete('work');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const hasDispute = useMemo(
    () =>
      steps.some((step) =>
        step.sessions.some((block) =>
          block.lines.some(
            (line) => line.kind === 'outcome' && line.findings.some((f) => f.dispute !== undefined),
          ),
        ),
      ),
    [steps],
  );

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className={COLUMN}>
            {!loading && conversation.error && (
              <p className="mb-5 text-xs leading-relaxed text-red-600 dark:text-red-400">{conversation.error}</p>
            )}
            {error && <p className="mb-5 text-xs text-red-600 dark:text-red-400">{error}</p>}

            {steps.map((step) => (
              <StepList key={step.key} step={step} selectedId={selected?.sessionId ?? null} onSelect={select} />
            ))}

            {!loading && !conversation.error && steps.length === 0 && (
              <p className="text-xs text-muted-foreground">Nothing has happened here yet.</p>
            )}
            {loading && (
              <p role="status" className="mt-5 text-xs text-muted-foreground">
                Reading the conversation…
              </p>
            )}
            {connectionError && (
              <p role="status" className="mt-5 text-xs text-muted-foreground">
                {connectionError}
              </p>
            )}
          </div>
        </div>
        <Composer status={run.status} />
      </div>
      {selected && (
        <FindingResolveProvider repoId={repoId} active={hasDispute}>
          <WorkPane block={selected} onClose={() => select(null)} />
        </FindingResolveProvider>
      )}
    </div>
  );
}

/**
 * The message box. A live conversation cannot take a message yet: the loop
 * has a steer entry per piece of work, but nothing outside the process
 * reaches it. An ended one never will. So the box is there, and closed, and
 * says which of the two it is.
 */
function Composer({ status }: { status: PublicSessionRun['status'] }) {
  return (
    <div className="flex shrink-0 justify-center border-t border-border px-6 py-3">
      <div className={`${COLUMN} flex items-center gap-2`}>
        <input
          disabled
          aria-label="Message this conversation"
          placeholder={
            status === 'running'
              ? 'Messages to a live conversation are not delivered yet'
              : 'This conversation has ended'
          }
          className="flex-1 rounded-[10px] border border-border bg-card px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <button
          type="button"
          disabled
          aria-label="Send"
          className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// the list
// ---------------------------------------------------------------------------

/** A step of the run: its heading and fact, then one row per piece of work under it. */
function StepList({
  step,
  selectedId,
  onSelect,
}: {
  step: StepBlock;
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <section className="mb-6">
      <h2 className="relative border-b border-border pb-1.5 text-sm font-semibold text-foreground">
        <span aria-hidden className={`absolute -left-5 top-[6px] h-2 w-2 rounded-full ${STEP_DOT[step.status]}`} />
        {step.label}
      </h2>
      {step.detail && <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{step.detail}</p>}
      {step.facts.length > 0 && <Facts facts={step.facts} />}
      {step.sessions.length > 0 && (
        <div className="mt-2">
          {step.sessions.map((block) => (
            <WorkRow key={block.sessionId} block={block} selected={block.sessionId === selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * What a piece of work is called, taken from the briefing it was given: the
 * line that names its flow (`FLOW: …`) when the briefing has one, else the
 * briefing's first line, else its work item.
 */
function titleOf(block: SessionBlock): string {
  const briefing = block.lines.find((line) => line.kind === 'user');
  if (!briefing || briefing.kind !== 'user') return block.workItem || block.kind;
  const lines = briefing.content.split('\n').map((l) => l.trim());
  return lines.find((l) => l.startsWith('FLOW:')) ?? lines.find((l) => l !== '') ?? block.workItem ?? block.kind;
}

/** The kind of work: the title the session stamped on itself, else the last segment of its kind id. */
const kindOf = (block: SessionBlock): string => block.title ?? (block.kind.split('.').pop() ?? block.kind);

/** How many of a step's facts show before the rest fold. */
const FACTS_SHOWN = 12;

/** What a step did, one line each as recorded; a long list folds past the first lines. */
function Facts({ facts }: { facts: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? facts : facts.slice(0, FACTS_SHOWN);
  return (
    <div className="mt-1.5">
      {shown.map((fact, i) => (
        <p key={i} className="whitespace-pre-wrap break-words text-[13px] leading-snug text-muted-foreground">
          {fact}
        </p>
      ))}
      {!open && facts.length > FACTS_SHOWN && (
        <button type="button" onClick={() => setOpen(true)} className="mt-0.5 text-[11px] text-muted-foreground/70 hover:text-foreground">
          +{facts.length - FACTS_SHOWN} lines
        </button>
      )}
    </div>
  );
}

/** How long a piece of work has been going, from its first event to its last. */
function tookOf(block: SessionBlock): string | undefined {
  if (block.lines.length < 2) return undefined;
  const ms = Date.parse(block.lines[block.lines.length - 1].ts) - Date.parse(block.lines[0].ts);
  return Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : undefined;
}

/** One row: the dot, the title, how long it took. Pressed when it is the open one. */
function WorkRow({ block, selected, onSelect }: { block: SessionBlock; selected: boolean; onSelect: (sessionId: string) => void }) {
  const took = tookOf(block);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(block.sessionId)}
      className={`flex w-full items-baseline gap-3 rounded-md py-1.5 pr-2 text-left text-[13px] leading-snug transition-colors hover:bg-muted/40 ${
        block.parentSessionId ? 'pl-7' : 'pl-2'
      } ${selected ? 'bg-muted/60 text-foreground' : 'text-foreground'}`}
    >
      <WorkDot status={block.status} className="self-center" />
      <span className="min-w-0 flex-1 truncate">{titleOf(block)}</span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{kindOf(block)}</span>
      {took && <span className="w-14 shrink-0 text-right tabular-nums text-[11px] text-muted-foreground">{took}</span>}
    </button>
  );
}

function WorkDot({ status, className = '' }: { status: SessionStatus; className?: string }) {
  return <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${WORK_DOT[status]} ${className}`} />;
}

// ---------------------------------------------------------------------------
// the pane
// ---------------------------------------------------------------------------

/**
 * The selected piece of work, whole: its title row, then its transcript with
 * its own scroll, following the end while it runs unless the reader scrolled
 * up.
 */
function WorkPane({ block, onClose }: { block: SessionBlock; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const toEnd = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
    follow.current = true;
  }, []);
  useEffect(() => {
    follow.current = true;
    toEnd();
  }, [block.sessionId, toEnd]);
  useEffect(() => {
    if (block.status === 'running' && follow.current) toEnd();
  }, [block.lines.length, block.live, block.status, toEnd]);
  const took = tookOf(block);
  return (
    <aside aria-label="Work" className="flex w-[56%] min-w-[420px] max-w-[880px] shrink-0 flex-col border-l border-border">
      <div className="flex h-11 shrink-0 items-center gap-3 px-5">
        <WorkDot status={block.status} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{titleOf(block)}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{kindOf(block)}</span>
        {took && <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{took}</span>}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-5 pb-6"
      >
        <Transcript block={block} />
      </div>
    </aside>
  );
}

/**
 * One piece of work's messages in the order they were written. A tool call
 * and the result that answers it are one exchange, even when the loop's own
 * events (a child the tool spawned, a grant) came between them; those follow
 * the pair.
 */
function Transcript({ block }: { block: SessionBlock }) {
  const rows: ReactNode[] = [];
  const lines = block.lines;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === 'assistant' && line.toolCall && !isOutcomeTool(line.toolCall.name) && !line.text) {
      const between: ConversationLine[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].kind !== 'assistant' && lines[j].kind !== 'tool') between.push(lines[j++]);
      const result = lines[j];
      if (result?.kind === 'tool' && result.toolName === line.toolCall.name) {
        rows.push(
          <Message key={line.key} ts={line.ts}>
            <Exchange call={line} result={result} />
          </Message>,
        );
        for (const skipped of between) rows.push(<Line key={skipped.key} line={skipped} />);
        i = j;
        continue;
      }
    }
    rows.push(<Line key={line.key} line={line} />);
  }
  return (
    <div>
      {rows}
      {block.live && <p className="mt-3 text-[13px] text-muted-foreground">{block.live}</p>}
    </div>
  );
}

/**
 * The tools that deliver the outcome rather than do work: the API driver's
 * reserved `outcome` tool and the Agent SDK's native `StructuredOutput`. The
 * outcome message that follows carries the same value, so the call itself
 * is not shown.
 */
const OUTCOME_TOOLS = new Set(['outcome', 'StructuredOutput']);
const isOutcomeTool = (name: string): boolean => OUTCOME_TOOLS.has(name);

const TEXT = 'whitespace-pre-wrap break-words text-[13px] leading-snug';
const MONO = 'whitespace-pre-wrap break-words font-mono text-[12px] leading-snug';
const RED = 'text-red-600 dark:text-red-400';

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const firstLine = (text: string): string => text.split('\n')[0];
const lineCount = (text: string): number => text.split('\n').length;

/** One message: its content, and the time on hover. */
function Message({ ts, children }: { ts: string; children?: ReactNode }) {
  return (
    <div className="group/row relative mt-4 pr-24">
      {children}
      <span className="absolute right-0 top-0 tabular-nums text-[11px] text-muted-foreground/70 opacity-0 transition-opacity group-hover/row:opacity-100">
        {timeOf(ts)}
      </span>
    </div>
  );
}

/**
 * Text as it was written, set as paragraphs: every character kept, a blank
 * line between two paragraphs becoming a paragraph gap rather than an empty
 * line, so a briefing reads like the document it is.
 */
function Paragraphs({ text, className }: { text: string; className: string }) {
  const parts = text.split(/\n{2,}/);
  return (
    <div className={className}>
      {parts.map((part, i) => (
        <p key={i} className={`${TEXT} ${i > 0 ? 'mt-2' : ''}`}>
          {part}
        </p>
      ))}
    </div>
  );
}

/** A long text as evidence: its first line and how many more, opening in place to the whole of it. */
function Folded({ text, className = 'text-muted-foreground' }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const n = lineCount(text);
  if (open) {
    return (
      <div role="button" tabIndex={0} aria-expanded onClick={() => setOpen(false)} onKeyDown={(e) => e.key === 'Enter' && setOpen(false)} className="cursor-pointer">
        <Paragraphs text={text} className={className} />
      </div>
    );
  }
  if (n === 1) return <p className={`${TEXT} ${className}`}>{text}</p>;
  return (
    <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className={`flex w-full min-w-0 items-baseline gap-2 text-left ${className}`}>
      <span className="min-w-0 truncate whitespace-nowrap text-[13px] leading-snug">{firstLine(text)}</span>
      <More n={n - 1} />
    </button>
  );
}

function More({ n }: { n: number }) {
  return <span className="shrink-0 text-[11px] text-muted-foreground/60">+{n} lines</span>;
}

type Pair = { call: Extract<ConversationLine, { kind: 'assistant' }>; result: Extract<ConversationLine, { kind: 'tool' }> };

/** One tool call and its answer: a mono line, the result set lighter and apart; open, the arguments and the whole result. */
function Exchange({ call, result }: Pair) {
  const [open, setOpen] = useState(false);
  const toolCall = call.toolCall!;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${toolCall.name} call`}
        className="flex w-full min-w-0 items-baseline gap-2 text-left font-mono text-[12px] text-muted-foreground"
      >
        <span className={`shrink-0 font-medium ${result.isError ? RED : ''}`}>{toolCall.name}</span>
        {!open && (
          <>
            <span className="min-w-0 max-w-[50%] truncate">{toolCall.args.replace(/\n\s*/g, ' ')}</span>
            <span className={`ml-3 min-w-0 flex-1 truncate ${result.isError ? RED : 'text-muted-foreground/60'}`}>
              {firstLine(result.content)}
            </span>
            {lineCount(result.content) > 1 && <More n={lineCount(result.content) - 1} />}
          </>
        )}
      </button>
      {open && (
        <div className="mt-1 rounded-md bg-muted/50 px-3 py-2">
          <div className="mb-1 font-mono text-[11px] text-muted-foreground/70">args</div>
          <pre className={`${MONO} text-foreground`}>{toolCall.args}</pre>
          <div className="mb-1 mt-3 font-mono text-[11px] text-muted-foreground/70">{result.isError ? 'result · isError' : 'result'}</div>
          <pre className={`${MONO} ${result.isError ? RED : 'text-foreground'}`}>{result.content}</pre>
        </div>
      )}
    </div>
  );
}

/** A mono value under its name: one compact line, opening in place to the whole of it. */
function Json({ value, label, tone = 'text-muted-foreground' }: { value: string; label: string; tone?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        className={`flex w-full min-w-0 items-baseline gap-2 text-left font-mono text-[12px] ${tone}`}
      >
        <span className="shrink-0 font-medium">{label}</span>
        {!open && <span className="min-w-0 truncate">{value.replace(/\n\s*/g, ' ')}</span>}
        {!open && lineCount(value) > 1 && <More n={lineCount(value) - 1} />}
      </button>
      {open && <pre className={`${MONO} mt-1 rounded-md bg-muted/50 px-3 py-2 ${tone === RED ? RED : 'text-foreground'}`}>{value}</pre>}
    </>
  );
}

/** A row of the event's own field names and their values. */
function Fields({ fields, tone = 'text-muted-foreground' }: { fields: readonly DataField[]; tone?: string }) {
  if (fields.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] ${tone}`}>
      {fields.map((f) => (
        <span key={f.label} className="min-w-0 break-words">
          <span className="opacity-70">{f.label}</span> <span className="font-mono">{f.value}</span>
        </span>
      ))}
    </div>
  );
}

function Line({ line }: { line: ConversationLine }) {
  switch (line.kind) {
    case 'system':
      return (
        <Message ts={line.ts}>
          <Folded text={line.systemPrompt} />
        </Message>
      );
    case 'user':
      return (
        <Message ts={line.ts}>
          {line.actor && <div className="text-[11px] text-muted-foreground">{line.actor}</div>}
          <Folded text={line.content} />
        </Message>
      );
    case 'assistant': {
      const call = line.toolCall && !isOutcomeTool(line.toolCall.name) ? line.toolCall : undefined;
      if (!call && !line.text) return null;
      return (
        <Message ts={line.ts}>
          {line.text && <Prose text={line.text} />}
          {call && <Json label={call.name} value={call.args} />}
        </Message>
      );
    }
    case 'tool':
      return (
        <Message ts={line.ts}>
          <Json label={line.toolName} value={line.content} tone={line.isError ? RED : undefined} />
        </Message>
      );
    case 'outcome':
      return (
        <Message ts={line.ts}>
          <Json label="outcome" value={line.value} />
          {line.findings.map((finding, i) => (
            <div key={i} className="mt-2">
              <FindingCard finding={finding} />
            </div>
          ))}
        </Message>
      );
    case 'failure': {
      const kind = line.fields.find((f) => f.label === 'kind')?.value ?? 'failure';
      const retry = line.fields.find((f) => f.label === 'retryability')?.value;
      const rest = line.fields.filter((f) => f.label !== 'kind' && f.label !== 'retryability');
      return (
        <Message ts={line.ts}>
          <p className={`font-mono text-[12px] ${RED}`}>
            <span className="font-medium">failure</span> {kind}
            {retry && <span className="text-muted-foreground"> · retryability {retry}</span>}
          </p>
          {rest.map((f) => (
            <div key={f.label} className="mt-1">
              <Json label={f.label} value={f.value} tone={RED} />
            </div>
          ))}
        </Message>
      );
    }
    case 'question':
      return (
        <Message ts={line.ts}>
          <p className={`${TEXT} text-foreground`}>{line.question.question}</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
            {line.question.options.map((opt) => (
              <li key={opt.label}>
                <span className="font-mono text-foreground">{opt.label}</span>
                {opt.description && <span> {opt.description}</span>}
              </li>
            ))}
          </ul>
        </Message>
      );
    case 'child':
      return (
        <Message ts={line.ts}>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[12px] text-muted-foreground">
            <span>{line.phase}</span>
            <span className="text-foreground">{line.child.kind}</span>
            <span className="min-w-0 truncate">{line.child.workItem}</span>
            {line.status && <span>{line.status}</span>}
          </p>
        </Message>
      );
    case 'data':
      return (
        <Message ts={line.ts}>
          <div className="flex flex-wrap items-baseline gap-x-3 text-[12px]">
            <span className="font-mono text-muted-foreground">{line.label}</span>
            <Fields fields={line.fields} />
          </div>
        </Message>
      );
  }
}

/**
 * The model's own prose, which it writes as markdown. Compact element styles:
 * the dashboard has no typography plugin.
 */
function Prose({ text }: { text: string }) {
  return (
    <div className="text-[13px] leading-snug text-foreground [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:mt-2 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
