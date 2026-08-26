/**
 * Activity, level two: one run read as a conversation.
 *
 * The run's step checklist (a block it declares, like every other) and its
 * session index are merged into a single chronological stream
 * ({@link buildRunStream}); anything else the run said about itself opens the
 * stream as plain lines. Each step is an activity
 * card — expanded while it is the open step (its live counter, one line per
 * session that did its work), compacted to its header row once it lands, and
 * re-expandable by its chevron. A session line opens its transcript in place,
 * rendered by the same {@link SessionThread} widgets the old pane used.
 *
 * The only CHAT BUBBLES here carry real transcript text: a session that is
 * `waiting` posts its open question into the stream as an agent message with a
 * "Needs you" marker. Nothing is narrated on the run's behalf — the cards and
 * the real messages carry the story.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react';
import type { SessionEvent, SessionIndexEntry } from '@truecourse/agent-loop';
import type { PublicSessionRun } from '@/lib/api';
import { Avatar, SessionThread } from './SessionThread';
import { toChatRows } from './transcript-model';
import { useSessionEvents } from './useSessionEvents';
import {
  STEP_DOT,
  RUN_STATUS_META,
  SESSION_STATUS_META,
  buildRunStream,
  commandLabel,
  lastAgentMessage,
  runDuration,
  shortRef,
  startedLabel,
  timeLabel,
  waitingCount,
  type StreamStep,
} from './run-model';

/** The stream column — the mock's 800px, centered, shrinking on narrow panes. */
const STREAM = 'w-[800px] max-w-full';

export function RunConversation({
  repoId,
  run,
  liveEvents,
  openSessionId,
  onOpenSession,
  onBack,
}: {
  repoId: string;
  run: PublicSessionRun;
  /** Socket-pushed events per session for THIS run. */
  liveEvents: ReadonlyMap<string, readonly SessionEvent[]>;
  /** The session whose thread is open (`?ses=`), or null. */
  openSessionId: string | null;
  onOpenSession: (sessionId: string | null) => void;
  onBack: () => void;
}) {
  const meta = RUN_STATUS_META[run.status];
  const waiting = waitingCount(run);
  const { steps, next, notes } = useMemo(() => buildRunStream(run), [run]);

  // A step card is open while its step is; a landed one compacts to its
  // header row until its chevron says otherwise. The override survives the
  // step moving on, which is the point of the chevron. A `?ses=` deep link
  // also opens whichever card holds that session, or its line would be hidden.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isOpen = (step: StreamStep): boolean =>
    overrides[step.key] ??
    (step.status === 'active' ||
      step.status === 'error' ||
      step.sessions.some((s) => s.sessionId === openSessionId));

  const scrollRef = useRef<HTMLDivElement>(null);
  const anchor = `${steps.length}:${run.sessions.length}:${run.status}`;
  useEffect(() => {
    if (run.status !== 'running') return;
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight });
  }, [anchor, run.status]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-6 text-xs">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Activity
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="min-w-0 truncate text-foreground">
          {commandLabel(run.command)} · {startedLabel(run.startedAt)}
        </span>
        <span className="ml-4 inline-flex shrink-0 items-center gap-1.5 text-foreground">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
          {meta.word}
        </span>
        <span className="shrink-0 font-mono text-muted-foreground">{shortRef(run.gitRef)}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{runDuration(run)}</span>
        {waiting > 0 && (
          <span className="ml-auto shrink-0 text-[11px] text-sky-400">
            {waiting} question{waiting === 1 ? '' : 's'} need{waiting === 1 ? 's' : ''} you
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-3 pt-5">
        <div className={`${STREAM} flex flex-col gap-4`}>
          {/* Whatever else the run said about itself, in its own words. */}
          {notes.length > 0 && (
            <div className="ml-[38px] flex flex-col gap-1 text-[11px] text-muted-foreground">
              {/* Keyed by position: notes are an ordered list with no identity
                  of their own, and two runs of one step can say the same thing. */}
              {notes.map((note, i) => (
                <p key={i}>{note}</p>
              ))}
            </div>
          )}
          {steps.length === 0 && (
            <p className="text-xs text-muted-foreground">
              This run has not opened a step yet.
            </p>
          )}
          {steps.map((step) => (
            <div key={step.key} className="flex flex-col gap-4">
              <StepCard
                step={step}
                open={isOpen(step)}
                onToggle={() => setOverrides((prev) => ({ ...prev, [step.key]: !isOpen(step) }))}
                repoId={repoId}
                run={run}
                liveEvents={liveEvents}
                openSessionId={openSessionId}
                onOpenSession={onOpenSession}
              />
              {step.sessions
                .filter((s) => s.status === 'waiting')
                .map((session) => (
                  <WaitingQuestion
                    key={session.sessionId}
                    repoId={repoId}
                    run={run}
                    session={session}
                    liveEvents={liveEvents.get(session.sessionId) ?? []}
                    open={openSessionId === session.sessionId}
                    onToggle={() =>
                      onOpenSession(openSessionId === session.sessionId ? null : session.sessionId)
                    }
                  />
                ))}
            </div>
          ))}
          {next && (
            <p className="ml-[38px] text-[11px] text-muted-foreground/70">Next: {next}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 justify-center border-t border-border px-6 py-3">
        <div className={`${STREAM} flex items-center gap-2`}>
          <input
            disabled
            aria-label="Message this run"
            placeholder={
              run.status === 'running' ? 'Answer, or steer the run' : 'Ask about this run, or start another'
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
    </div>
  );
}

/**
 * One step as an activity card: the header row always, its session lines
 * while open. Indented to the bubble gutter so cards and messages read as one
 * column.
 *
 * No duration on the header, and none on a session line: neither a checklist
 * step nor a session index entry carries timestamps, and the run's own start
 * is the only clock the store hands this surface. A number would have to be
 * invented, so the space stays blank.
 */
function StepCard({
  step,
  open,
  onToggle,
  repoId,
  run,
  liveEvents,
  openSessionId,
  onOpenSession,
}: {
  step: StreamStep;
  open: boolean;
  onToggle: () => void;
  repoId: string;
  run: PublicSessionRun;
  liveEvents: ReadonlyMap<string, readonly SessionEvent[]>;
  openSessionId: string | null;
  onOpenSession: (sessionId: string | null) => void;
}) {
  return (
    <div className="ml-[38px] flex max-w-[560px] flex-col overflow-hidden rounded-[10px] border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown aria-hidden className="h-3 w-3 shrink-0 text-foreground" />
        ) : (
          <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span aria-hidden className={`h-[7px] w-[7px] shrink-0 rounded-full ${STEP_DOT[step.status]}`} />
        <span className="min-w-0 truncate text-xs font-medium text-foreground">{step.label}</span>
        {step.detail && (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">{step.detail}</span>
        )}
      </button>
      {open && step.sessions.length > 0 && (
        <div className="flex flex-col gap-[7px] border-t border-border/60 px-3 py-2.5">
          {step.sessions.map((session) => (
            <SessionLine
              key={session.sessionId}
              repoId={repoId}
              run={run}
              session={session}
              liveEvents={liveEvents.get(session.sessionId) ?? []}
              open={openSessionId === session.sessionId}
              onToggle={() =>
                onOpenSession(openSessionId === session.sessionId ? null : session.sessionId)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One session inside a step card. A `waiting` session is a plain line here —
 * its thread hangs off the question bubble below the card instead, so the same
 * transcript never renders twice in one stream.
 */
function SessionLine({
  repoId,
  run,
  session,
  liveEvents,
  open,
  onToggle,
}: {
  repoId: string;
  run: PublicSessionRun;
  session: SessionIndexEntry;
  liveEvents: readonly SessionEvent[];
  open: boolean;
  onToggle: () => void;
}) {
  const meta = SESSION_STATUS_META[session.status];
  const asks = session.status === 'waiting';
  const events = useSessionEvents(
    repoId,
    run.command,
    run.runId,
    session.sessionId,
    liveEvents,
    open && !asks,
  );

  const body = (
    <>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${meta.dot}`} />
      <span className="min-w-0 truncate font-mono">{session.workItem}</span>
      <span className="shrink-0">{meta.word}</span>
      {session.spent.turns > 0 && (
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/70">
          {session.spent.turns} turns
        </span>
      )}
    </>
  );

  if (asks) {
    return (
      <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">{body}</div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        {...(open ? { 'aria-current': 'true' as const } : {})}
        className={`flex w-full items-baseline gap-2 text-left text-[11px] ${
          open ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {body}
      </button>
      {open && (
        <div className="mt-1.5">
          <SessionThread
            repoId={repoId}
            session={session}
            events={events.events}
            loading={events.loading}
            error={events.error}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A waiting session's open question, as a real message in the stream: the
 * agent's last words out of its own transcript, marked "Needs you". Clicking
 * it opens the full thread underneath.
 */
function WaitingQuestion({
  repoId,
  run,
  session,
  liveEvents,
  open,
  onToggle,
}: {
  repoId: string;
  run: PublicSessionRun;
  session: SessionIndexEntry;
  liveEvents: readonly SessionEvent[];
  open: boolean;
  onToggle: () => void;
}) {
  // Unopened, unlike every other session: the question IS the message, so the
  // transcript loads to find it.
  const { events, loading, error } = useSessionEvents(
    repoId,
    run.command,
    run.runId,
    session.sessionId,
    liveEvents,
    true,
  );
  const question = lastAgentMessage(toChatRows(events));
  const at = events.length > 0 ? events[events.length - 1].ts : run.startedAt;

  return (
    <div className="flex gap-2.5">
      <Avatar size="stream" live ring />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">TrueCourse</span>
          <span>{timeLabel(at)}</span>
          <span className="font-medium text-sky-400">Needs you</span>
          <span className="min-w-0 truncate font-mono text-muted-foreground/70">{session.workItem}</span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          {...(open ? { 'aria-current': 'true' as const } : {})}
          className="max-w-[640px] whitespace-pre-wrap rounded-xl rounded-tl-sm border border-sky-500/35 px-3.5 py-2.5 text-left text-[13px] leading-relaxed text-foreground"
        >
          {question ?? (loading ? 'Reading the question…' : 'This session is waiting on an answer.')}
        </button>
        {open && (
          <SessionThread
            repoId={repoId}
            session={session}
            events={events}
            loading={loading}
            error={error}
          />
        )}
      </div>
    </div>
  );
}
