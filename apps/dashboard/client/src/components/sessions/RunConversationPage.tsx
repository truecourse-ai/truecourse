/**
 * One conversation, as one column: the transcript itself.
 *
 * NOTHING HERE IS WRITTEN BY THIS PAGE. Every message is the event that was
 * recorded, whole: the system prompt as it was sent, the briefing and every
 * intervention as they were written, each turn's text and its tool call's
 * arguments, each result's content, the outcome's value. What this file
 * chooses is how a field LOOKS, never what it says: a role label, a field
 * name, mono for anything the machine wrote, red for a failure.
 *
 * Nothing is folded or truncated for length, and there are no expanders. The
 * outline on the left is the way around a long conversation. The whole of it
 * is laid out at once: that is one frame of work, and it keeps the end, the
 * outline's highlight and the way back down exact.
 *
 * The page is HEADERLESS: whoever mounts it owns the header row.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { SessionStatus } from '@truecourse/agent-loop';
import type { PublicSessionRun } from '@/lib/api';
import { StatusWord, type StatusTone } from '@/preview/ui/status-word';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { FindingCard, FindingResolveProvider } from './conversation-pieces';
import { STEP_DOT } from './run-model';
import { useRunConversation } from './useRunConversation';
import type { ConversationLine, DataField, SessionBlock, StepBlock } from './conversation-model';

const EMPTY_STEPS: readonly StepBlock[] = [];

/** The reading column: wide enough for a quoted diff, narrow enough to read. */
const COLUMN = 'mx-auto w-[780px] max-w-full';

/** The colour a status value wears. The WORD is always the value itself. */
const STATUS_TONE: Record<SessionStatus, StatusTone> = {
  running: 'running',
  waiting: 'attention',
  parked: 'attention',
  completed: 'success',
  failed: 'failure',
};

export function RunConversationPage({ run, repoId }: { run: PublicSessionRun; repoId: string }) {
  const { conversation, loading, error, connectionError } = useRunConversation(run, repoId);
  // History lands page by page; painting it as it comes shows every work line
  // before its lines, so the page waits for the whole of it and paints once.
  const steps = loading ? EMPTY_STEPS : conversation.steps;

  const headings = useRef(new Map<string, HTMLElement>());
  const scroller = useRef<HTMLDivElement>(null);
  // A conversation opens at its end, the way a chat does, and a live one keeps
  // following its end. Scrolling up hands the column back: reading is never
  // yanked out from under the reader, and a button offers the way down.
  const [atEnd, setAtEnd] = useState(true);
  const follow = useRef(true);
  const toEnd = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
    follow.current = true;
    setAtEnd(true);
  }, []);
  const opened = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!opened.current) {
      opened.current = true;
      toEnd();
      return;
    }
    if (run.status === 'running' && follow.current) toEnd();
  }, [conversation, loading, run.status, toEnd]);
  // The column still grows after the first scroll (fonts, images, a live
  // append); while the reader has not scrolled up, every growth pulls the end
  // back into view.
  const column = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = column.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (follow.current) toEnd();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [toEnd]);

  // The outline marks the step the reader is in: the last heading that has
  // passed the top of the column, or the last step once the column is at its
  // end, so the step that never reaches the top still gets its turn.
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const spy = useCallback(() => {
    const el = scroller.current;
    if (!el || steps.length === 0) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 2) {
      setActiveStep(steps[steps.length - 1].key);
      return;
    }
    const top = el.getBoundingClientRect().top;
    let current = steps[0].key;
    for (const step of steps) {
      const heading = headings.current.get(step.key);
      if (heading && heading.getBoundingClientRect().top - top <= 24) current = step.key;
    }
    setActiveStep(current);
  }, [steps]);
  useEffect(spy, [spy]);

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
      <Outline
        steps={steps}
        activeKey={activeStep}
        onJump={(key) => {
          setActiveStep(key);
          headings.current.get(key)?.scrollIntoView({ block: 'start' });
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            const end = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            follow.current = end;
            setAtEnd(end);
            spy();
          }}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
        >
          <div ref={column} className={COLUMN}>
            {!loading && conversation.error && (
              <p className="mb-5 text-xs leading-relaxed text-red-600 dark:text-red-400">{conversation.error}</p>
            )}
            {error && <p className="mb-5 text-xs text-red-600 dark:text-red-400">{error}</p>}

            <FindingResolveProvider repoId={repoId} active={hasDispute}>
              {steps.map((step) => (
                <Step
                  key={step.key}
                  step={step}
                  register={(el) => {
                    if (el) headings.current.set(step.key, el);
                    else headings.current.delete(step.key);
                  }}
                />
              ))}
            </FindingResolveProvider>

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
        <div className="relative">
          {!atEnd && (
            <button
              type="button"
              onClick={toEnd}
              aria-label="Jump to the end"
              className="absolute -top-11 left-1/2 inline-flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm hover:bg-muted"
            >
              <ArrowDown aria-hidden className="h-4 w-4" />
            </button>
          )}
          <Composer status={run.status} />
        </div>
      </div>
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

/** The step list, as navigation: where the work is, and which step the reader is in. */
function Outline({
  steps,
  activeKey,
  onJump,
}: {
  steps: readonly StepBlock[];
  activeKey: string | null;
  onJump: (key: string) => void;
}) {
  if (steps.length === 0) return null;
  return (
    <nav aria-label="Outline" className="w-44 shrink-0 overflow-y-auto border-r border-border bg-card/40 px-2 py-3">
      <div className="space-y-0.5">
        {steps.map((step) => (
          <button
            key={step.key}
            type="button"
            aria-current={activeKey === step.key ? 'location' : undefined}
            onClick={() => onJump(step.key)}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition-colors ${
              activeKey === step.key
                ? 'bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            }`}
          >
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STEP_DOT[step.status]}`} />
            <span className="min-w-0 truncate">{step.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function Step({ step, register }: { step: StepBlock; register: (el: HTMLElement | null) => void }) {
  return (
    <section className="mb-7 scroll-mt-4">
      <h2 ref={register} className="relative border-b border-border pb-1.5 text-sm font-semibold text-foreground">
        <span aria-hidden className={`absolute -left-5 top-[6px] h-2 w-2 rounded-full ${STEP_DOT[step.status]}`} />
        <span className="min-w-0">{step.label}</span>
      </h2>
      {step.detail && <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{step.detail}</p>}
      {step.sessions.map((block) => (
        <Paragraph key={block.sessionId} block={block} />
      ))}
    </section>
  );
}

/**
 * One inner session: its messages in the order they were written, the
 * exchange itself and nothing else: the prompts, the calls and their
 * results, the outcome value, one line each, opening in place. A finished
 * piece of work ends on its outcome; only unfinished work wears its status.
 */
function Paragraph({ block }: { block: SessionBlock }) {
  const rows: ReactNode[] = [];
  const lines = block.lines;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A tool call and the result that answers it are one exchange, even when
    // the loop's own events (a child the tool spawned, a grant) came between
    // them; those follow the pair.
    if (line.kind === 'assistant' && line.toolCall && line.toolCall.name !== OUTCOME_TOOL && !line.text) {
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
    <section id={block.sessionId} className="mt-8 scroll-mt-4">
      {block.status !== 'completed' && <StatusWord tone={STATUS_TONE[block.status]} word={block.status} />}
      {rows}
      {block.live && <p className="mt-2 text-[13px] text-muted-foreground">{block.live}</p>}
    </section>
  );
}

/** The tool the driver reserves for delivering the outcome. */
const OUTCOME_TOOL = 'outcome';

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
      const call = line.toolCall && line.toolCall.name !== OUTCOME_TOOL ? line.toolCall : undefined;
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
