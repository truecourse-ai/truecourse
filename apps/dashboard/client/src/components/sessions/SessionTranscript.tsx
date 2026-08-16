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
import { ChevronDown, ChevronRight, ListChecks, Send, Wrench } from 'lucide-react';
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
        {ok != null && (
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
        )}
      </button>
      {open && <div className={`${PRE} border-t border-border/70 px-2 py-1.5`}>{children}</div>}
    </div>
  );
}

const OUTCOME_DOT = {
  ok: 'bg-emerald-500',
  warn: 'bg-sky-500',
  fail: 'bg-red-500',
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
        <div className="max-w-[88%] rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
          {event.text}
        </div>
      );
    case 'user-message':
      return (
        <div className="ml-auto max-w-[88%] rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
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
            {event.applied && (
              <span className="ml-auto inline-flex items-center gap-1.5 normal-case font-normal tracking-normal text-foreground">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                Applied
              </span>
            )}
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
                <span className="inline-flex shrink-0 items-center gap-1.5 pt-0.5 text-[10px] font-medium text-foreground">
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${g.verdict === 'keep' ? 'bg-emerald-500' : 'bg-red-500'}`}
                  />
                  {g.verdict === 'keep' ? 'Keep' : 'Exclude'}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    case 'question':
      return (
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${event.answer ? 'bg-emerald-500' : 'bg-sky-500'}`} />
            {event.answer ? 'Question · answered' : 'Question · needs you'}
          </div>
          <p className="px-3 py-2 text-xs leading-relaxed text-foreground">{event.text}</p>
          {event.answer ? (
            <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              Answered: <span className="text-foreground">{event.answer}</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
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
                  Session ended. Answers apply on the next run.
                </span>
              )}
            </div>
          )}
        </div>
      );
    case 'outcome':
      return (
        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${OUTCOME_DOT[event.tone]}`} />
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
            Queued. The transcript appears once the session starts.
          </p>
        ) : (
          events.map((event) => <EventBlock key={event.id} event={event} live={live} onAction={post} />)
        )}
        {waiting && (
          <div className="animate-pulse text-[11px] text-muted-foreground">thinking…</div>
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
              ? 'Send an instruction to this session…'
              : runLive
                ? 'This session is not interactive right now.'
                : 'Session ended. Resume the run to continue.'
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
