/**
 * UI MOCK — one session's transcript rendered as a conversation (plan §3.7):
 * chat bubbles for replies and user messages, compact expandable rows for tool
 * calls, and interactive CARDS for the structured events (scope proposal,
 * pending question, outcome). Every card action serializes to a user message,
 * so clicking IS chat and the transcript stays the single record. The chat
 * input is live only while the session is; here "live" is mock state and the
 * replies are canned.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  ListChecks,
  Send,
  Wrench,
  XCircle,
} from 'lucide-react';
import { PRE } from '@/components/guard/detail-styles';
import {
  MOCK_ANSWER_REPLY,
  MOCK_CHAT_REPLY,
  type MockSession,
  type TranscriptEvent,
} from './mock';

let mockId = 0;
const nextId = () => `mock-${++mockId}`;

function Collapsible({ label, icon, ok, duration, children }: {
  label: string;
  icon?: React.ReactNode;
  ok?: boolean;
  duration?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-border/70 bg-muted/30 font-mono text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {duration && <span className="shrink-0 text-muted-foreground/70">{duration}</span>}
        {ok != null &&
          (ok ? (
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
          ) : (
            <XCircle className="h-3 w-3 shrink-0 text-red-500" />
          ))}
      </button>
      {open && <div className={`${PRE} border-t border-border/70 px-2 py-1.5`}>{children}</div>}
    </div>
  );
}

const OUTCOME_TONE = {
  ok: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
  warn: 'border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400',
  fail: 'border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400',
} as const;

function EventBlock({ event, live, onAction }: {
  event: TranscriptEvent;
  live: boolean;
  onAction: (userText: string, reply: string) => void;
}) {
  const [freeText, setFreeText] = useState('');
  switch (event.kind) {
    case 'system':
      return <Collapsible label="system prompt">{event.text}</Collapsible>;
    case 'reply':
      return (
        <div className="flex max-w-[88%] items-start gap-2">
          <Bot className="mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
            {event.text}
          </div>
        </div>
      );
    case 'user-message':
      return (
        <div className="ml-auto max-w-[88%] rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
          {event.text}
        </div>
      );
    case 'tool':
      return (
        <Collapsible
          label={event.label}
          icon={<Wrench className="h-3 w-3 shrink-0" />}
          ok={event.ok}
          duration={event.duration}
        >
          {event.detail}
        </Collapsible>
      );
    case 're-ask':
      return (
        <div className="py-0.5 text-center text-[10px] italic text-muted-foreground/80">{event.note}</div>
      );
    case 'proposal':
      return (
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ListChecks className="h-3 w-3" />
            {event.title}
            {event.applied && <span className="ml-auto normal-case font-normal tracking-normal text-emerald-500">Applied — verdicts recorded</span>}
          </div>
          <div>
            {event.groups.map((g) => (
              <div key={g.id} className="flex items-start gap-3 border-b border-border/60 px-3 py-1.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium text-foreground">{g.name}</span>
                    <span className="text-[10px] text-muted-foreground">{g.docs} docs</span>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">{g.reason}</p>
                </div>
                <div className="flex shrink-0 gap-1 pt-0.5">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      g.verdict === 'keep'
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-border text-muted-foreground/50'
                    }`}
                  >
                    Keep
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      g.verdict === 'exclude'
                        ? 'border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400'
                        : 'border-border text-muted-foreground/50'
                    }`}
                  >
                    Exclude
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case 'question':
      return (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5">
          <div className="flex items-center gap-1.5 border-b border-amber-500/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            <HelpCircle className="h-3 w-3" />
            {event.answer ? 'Question — answered' : 'Question — needs you'}
          </div>
          <p className="px-3 py-2 text-xs leading-relaxed text-foreground">{event.text}</p>
          {event.answer ? (
            <div className="border-t border-amber-500/30 px-3 py-1.5 text-[11px] text-muted-foreground">
              Answered: <span className="text-foreground">{event.answer}</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-amber-500/30 px-3 py-2">
              {event.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  disabled={!live}
                  onClick={() => {
                    event.answer = opt;
                    onAction(opt, MOCK_ANSWER_REPLY);
                  }}
                  className="rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {opt}
                </button>
              ))}
              <form
                className="flex min-w-40 flex-1 gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = freeText.trim();
                  if (!text) return;
                  event.answer = text;
                  setFreeText('');
                  onAction(text, MOCK_ANSWER_REPLY);
                }}
              >
                <input
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  disabled={!live}
                  placeholder="Or answer in your own words…"
                  aria-label="Answer the question"
                  className="w-full flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
              </form>
              {!live && (
                <span className="w-full text-[10px] text-muted-foreground">
                  Session ended — an answer persists as a decision and applies on the next run.
                </span>
              )}
            </div>
          )}
        </div>
      );
    case 'outcome':
      return (
        <div className={`rounded-lg border px-3 py-2 ${OUTCOME_TONE[event.tone]}`}>
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            {event.tone === 'ok' ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : event.tone === 'warn' ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            {event.title}
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-muted-foreground">
            {event.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      );
  }
}

export function SessionTranscript({ session, runLive }: { session: MockSession; runLive: boolean }) {
  // Mock chat state — events appended locally on top of the session's script.
  const [extra, setExtra] = useState<TranscriptEvent[]>([]);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A new session selection starts from its own script.
  useEffect(() => {
    setExtra([]);
    setDraft('');
    setWaiting(false);
  }, [session.id]);

  const events = [...session.events, ...extra];
  const live = runLive && (session.status === 'active' || session.status === 'awaiting-input');

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [session.id, events.length]);

  const post = (userText: string, reply: string) => {
    setExtra((prev) => [...prev, { id: nextId(), kind: 'user-message', text: userText }]);
    setWaiting(true);
    setTimeout(() => {
      setExtra((prev) => [...prev, { id: nextId(), kind: 'reply', text: reply }]);
      setWaiting(false);
    }, 900);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-xs font-semibold text-foreground">{session.kind}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{session.workItem}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {session.turns}/{session.budget} turns
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
        {events.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Queued — this session has not started; its transcript appears here live.
          </p>
        ) : (
          events.map((event) => <EventBlock key={event.id} event={event} live={live} onAction={post} />)
        )}
        {waiting && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Bot className="h-3.5 w-3.5" />
            <span className="animate-pulse">thinking…</span>
          </div>
        )}
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (!text || !live) return;
          setDraft('');
          post(text, MOCK_CHAT_REPLY);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!live}
          placeholder={
            live
              ? 'Steer the session — instructions land in the transcript and persist as decisions…'
              : runLive
                ? 'This session is not interactive right now.'
                : 'Session ended — resume the run to continue the conversation.'
          }
          aria-label="Chat with the session"
          className="w-full flex-1 rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!live || draft.trim() === ''}
          aria-label="Send"
          className="rounded border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
