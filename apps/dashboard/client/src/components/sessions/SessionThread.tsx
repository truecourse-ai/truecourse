/**
 * One session rendered as a CHAT: the agent narrates on the left
 * — an intro line, did-bubbles for its tool work, finding cards, questions —
 * and the watching person is the only right-side voice (their answers, and
 * any actor-labelled message). Machinery never renders; the fold in
 * transcript-model drops it. A did-bubble expands in place to its per-call
 * detail (step → calls → raw result), and auto-expands when a call failed.
 * While the session runs, the last message is the agent's live status bubble,
 * updating off the stream.
 *
 * This is a BLOCK, not a pane: the run's conversation expands one of these in
 * place under a session line, so it brings no header and no scroller of its
 * own. Its events are handed in (see `useSessionEvents`) — the thread only
 * renders. Read-only; the composer lives on the run, not the session.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bot, Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { SessionEvent, SessionIndexEntry } from '@truecourse/agent-loop';
import { buildCorpusConflicts, resolutionForConflict } from '@truecourse/shared';
import * as api from '@/lib/api';
import type { SpecConflictResolution } from '@/lib/api';
import {
  distinctDocRefs,
  shortDocRef,
  toChatRows,
  type ActionCall,
  type ChatFinding,
  type ChatRow,
  type FindingDispute,
} from './transcript-model';

/**
 * What a finding card needs to RESOLVE its dispute in place — the same verdict
 * API the Coverage conflicts page uses, provided by the transcript so cards
 * stay presentational. `resolutions` is the persisted verdict list (null while
 * loading); `coverageHref` deep-links the same dispute on the Coverage page.
 */
interface FindingResolveCtx {
  resolutions: SpecConflictResolution[] | null;
  resolve: (dispute: FindingDispute, verdict: 'a' | 'b' | 'dismissed') => Promise<void>;
  undo: (dispute: FindingDispute) => Promise<void>;
  coverageHref: (dispute: FindingDispute) => string;
}

const FindingResolveContext = createContext<FindingResolveCtx | null>(null);

/** One derived Coverage conflict record — the same shape both pages build. */
type ConflictRecord = ReturnType<typeof buildCorpusConflicts>[number];

const rowKey = (row: ChatRow): string => `${row.seq}.${row.sub ?? 0}`;

/**
 * THE bot avatar. `size="stream"` is the 28px circle the run conversation puts
 * beside a real message; the default 24px one heads a stack inside a thread.
 * `ring` marks the message that needs an answer.
 */
export function Avatar({ live, size, ring }: { live?: boolean; size?: 'stream'; ring?: boolean }) {
  const stream = size === 'stream';
  return (
    <span
      aria-hidden
      className={`mt-0.5 flex shrink-0 items-center justify-center rounded-full border bg-card ${
        stream ? 'h-7 w-7' : 'h-6 w-6'
      } ${ring ? 'border-sky-500' : 'border-border'} ${live ? 'text-sky-500' : 'text-sky-500/70'}`}
    >
      <Bot className={stream ? 'h-[15px] w-[15px]' : 'h-3.5 w-3.5'} />
    </span>
  );
}

const AGENT_BUBBLE = 'w-fit max-w-full rounded-xl rounded-tl border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap';

/** One call inside an expanded step; its raw result is one level deeper. */
function CallRow({ call }: { call: ActionCall }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={call.detail === ''}
        className="flex w-full items-baseline gap-2 py-0.5 text-left text-[11px] text-muted-foreground enabled:hover:text-foreground"
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${
            call.ok === undefined ? 'bg-muted-foreground/40' : call.ok ? 'bg-emerald-500' : 'bg-red-500'
          }`}
        />
        <span className="min-w-0 truncate font-mono">{call.target || '(no arguments)'}</span>
        {call.duration && (
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/70">{call.duration}</span>
        )}
      </button>
      {open && call.detail !== '' && (
        <pre className="mb-1 ml-3.5 max-h-60 overflow-auto whitespace-pre-wrap rounded border border-border/70 bg-background px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground">
          {call.detail}
        </pre>
      )}
    </div>
  );
}

/** A did-bubble: the step sentence, expandable to its calls in place. */
function ActionBubble({ row }: { row: Extract<ChatRow, { kind: 'action' }> }) {
  const failed = row.calls.filter((c) => c.ok === false).length;
  // A mid-run error the agent recovered from (later calls succeeded) is normal
  // self-correction — a calm aside, not an alarm. Only a step whose LAST call
  // failed ends in a bad state worth the red dot and the auto-expand.
  const endsFailed = row.calls.length > 0 && row.calls[row.calls.length - 1].ok === false && !row.inFlight;
  const recovered = failed - (endsFailed ? 1 : 0);
  const aside =
    recovered > 0
      ? recovered === 1
        ? ' (one attempt failed along the way)'
        : ` (${recovered} attempts failed along the way)`
      : '';
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (endsFailed) setOpen(true);
  }, [endsFailed]);
  return (
    <div className={`${AGENT_BUBBLE} text-muted-foreground`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline gap-1.5 text-left hover:text-foreground"
      >
        <span className="self-center">
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        </span>
        <span className="min-w-0">
          {row.phrase}
          {aside}
          {row.inFlight && ' …'}
        </span>
        {endsFailed && <span aria-hidden className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-red-500" />}
        {!row.inFlight && row.duration && (
          <span className="ml-auto shrink-0 pl-3 text-[10px] tabular-nums text-muted-foreground/70">{row.duration}</span>
        )}
      </button>
      {open && (
        <div className="mt-1.5 border-l border-border pl-2.5">
          {row.calls.map((call, i) => (
            <CallRow key={i} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}

function FindingCard({ finding }: { finding: ChatFinding }) {
  return (
    <div className="max-w-full overflow-hidden rounded-xl rounded-tl border border-border">
      <div className="px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-500">
          Disagreement
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-foreground">{finding.claim}</p>
      </div>
      {finding.quotes.length > 0 && (
        <div className={`grid border-t border-border ${finding.quotes.length > 1 ? 'sm:grid-cols-2' : ''}`}>
          {finding.quotes.map((q, i) => (
            <div key={i} className={`min-w-0 px-3 py-2 ${i > 0 ? 'border-t border-border sm:border-l sm:border-t-0' : ''}`}>
              <div
                className={`truncate font-mono text-[10px] ${
                  finding.recommendation?.doc === q.doc ? 'text-emerald-600 dark:text-emerald-500' : 'text-muted-foreground'
                }`}
                title={q.heading}
              >
                {q.doc}
              </div>
              <pre className="mt-1 overflow-x-auto rounded border border-border/70 bg-background px-2 py-1.5 font-mono text-[11px] text-foreground">
                {q.quote}
              </pre>
            </div>
          ))}
        </div>
      )}
      {finding.recommendation && (
        <div className="flex items-baseline gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0">
            {finding.recommendation.doc ? (
              <>
                I'd follow <span className="text-foreground">{finding.recommendation.doc}</span>
                {finding.recommendation.rationale && <>: {finding.recommendation.rationale}</>}
              </>
            ) : (
              finding.recommendation.rationale || 'No clear side to pick.'
            )}
          </span>
          {finding.recommendation.confidence && (
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
              {finding.recommendation.confidence} confidence
            </span>
          )}
        </div>
      )}
      {finding.dispute && (
        <FindingResolveFooter
          dispute={finding.dispute}
          recommended={
            finding.recommendation?.doc === shortDocRef(finding.dispute.docA)
              ? 'a'
              : finding.recommendation?.doc === shortDocRef(finding.dispute.docB)
                ? 'b'
                : undefined
          }
        />
      )}
    </div>
  );
}

const VERDICT_BTN =
  'inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] text-foreground hover:border-sky-500 disabled:opacity-50';

/**
 * The in-place resolution row: the same pick-a-side / dismiss verdicts the
 * Coverage conflicts page records, writing the identical dispute identity to
 * decisions.json, plus the deep link to that page for the full detail. The
 * side the agent recommended carries the same green its quote header does.
 */
function FindingResolveFooter({
  dispute,
  recommended,
}: {
  dispute: FindingDispute;
  recommended?: 'a' | 'b';
}) {
  const ctx = useContext(FindingResolveContext);
  const [busy, setBusy] = useState<'a' | 'b' | 'dismissed' | 'undo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!ctx) return null;
  const [nameA, nameB] = distinctDocRefs(dispute.docA, dispute.docB);
  // Same chrome on every verdict button; the recommended side is marked by a
  // check inside the button, matching its quote header's green.
  const recommendedMark = (
    <Check aria-hidden className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-500" />
  );

  const resolution = resolutionForConflict(ctx.resolutions ?? [], dispute.docA, dispute.docB, [
    { doc: dispute.docA, heading: dispute.anchorA, quote: dispute.quoteA },
    { doc: dispute.docB, heading: dispute.anchorB, quote: dispute.quoteB },
  ]);

  const act = async (verdict: 'a' | 'b' | 'dismissed' | 'undo'): Promise<void> => {
    setBusy(verdict);
    setError(null);
    try {
      if (verdict === 'undo') await ctx.undo(dispute);
      else await ctx.resolve(dispute, verdict);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-1.5">
      {ctx.resolutions === null ? (
        <span className="text-[11px] text-muted-foreground/70">Checking for a recorded verdict…</span>
      ) : resolution ? (
        <>
          <span className="text-[11px] text-foreground">
            {resolution.verdict === 'dismissed' ? (
              'Dismissed, not a real conflict'
            ) : (
              <>
                Resolved:{' '}
                <span className="text-emerald-600 dark:text-emerald-500">
                  {distinctDocRefs(resolution.docA, resolution.docB)[resolution.verdict === 'a' ? 0 : 1]}
                </span>{' '}
                wins
              </>
            )}
          </span>
          {resolution.resolvedBy === 'auto' && (
            <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">auto</span>
          )}
          <button type="button" onClick={() => void act('undo')} disabled={busy !== null} className={VERDICT_BTN}>
            {busy === 'undo' ? 'Undoing…' : 'Undo'}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void act('a')}
            disabled={busy !== null}
            title={recommended === 'a' ? 'The recommendation above' : undefined}
            className={VERDICT_BTN}
          >
            {recommended === 'a' && recommendedMark}
            {busy === 'a' ? 'Recording…' : `Follow ${nameA}`}
          </button>
          <button
            type="button"
            onClick={() => void act('b')}
            disabled={busy !== null}
            title={recommended === 'b' ? 'The recommendation above' : undefined}
            className={VERDICT_BTN}
          >
            {recommended === 'b' && recommendedMark}
            {busy === 'b' ? 'Recording…' : `Follow ${nameB}`}
          </button>
          <button type="button" onClick={() => void act('dismissed')} disabled={busy !== null} className={VERDICT_BTN}>
            {busy === 'dismissed' ? 'Recording…' : 'Not a real conflict'}
          </button>
        </>
      )}
      {error && <span className="text-[11px] text-red-500">{error}</span>}
      <Link
        to={ctx.coverageHref(dispute)}
        className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Open in Coverage
        <ArrowUpRight aria-hidden className="h-3 w-3 shrink-0" />
      </Link>
    </div>
  );
}

function QuestionBlock({ row }: { row: Extract<ChatRow, { kind: 'question' }> }) {
  return (
    <>
      <div className={AGENT_BUBBLE}>{row.question.question}</div>
      <div className="flex flex-wrap gap-1.5">
        {row.question.options.map((opt) => (
          <span
            key={opt.label}
            title={opt.description}
            className={`rounded-lg border px-2.5 py-1 text-[11px] ${
              row.answer === opt.label
                ? 'border-sky-500 text-foreground'
                : 'border-border bg-background text-muted-foreground'
            }`}
          >
            {opt.label}
          </span>
        ))}
      </div>
      {!row.answer && (
        <p className="text-[10px] text-muted-foreground/80">
          Unanswered. The run proceeds on defaults; answering applies on the next run.
        </p>
      )}
    </>
  );
}

function CloseBlock({ row }: { row: Extract<ChatRow, { kind: 'close' }> }) {
  return (
    <div className={AGENT_BUBBLE}>
      <div className="flex items-center gap-1.5 font-semibold">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${row.tone === 'ok' ? 'bg-emerald-500' : 'bg-red-500'}`} />
        {row.headline}
      </div>
      {row.facts.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
          {row.facts.map((fact, i) => (
            <span key={i}>{fact}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One left-side block inside an agent message stack. */
function AgentBlock({ row }: { row: Exclude<ChatRow, { kind: 'user' } | { kind: 'note' }> }) {
  switch (row.kind) {
    case 'agent-text':
      return <div className={AGENT_BUBBLE}>{row.text}</div>;
    case 'action':
      return <ActionBubble row={row} />;
    case 'question':
      return <QuestionBlock row={row} />;
    case 'finding':
      return <FindingCard finding={row.finding} />;
    case 'close':
      return <CloseBlock row={row} />;
  }
}

/** Consecutive left-side rows share one avatar — a message stack. */
type Chunk =
  | { kind: 'agent'; rows: Exclude<ChatRow, { kind: 'user' } | { kind: 'note' }>[] }
  | { kind: 'user'; row: Extract<ChatRow, { kind: 'user' }> }
  | { kind: 'note'; row: Extract<ChatRow, { kind: 'note' }> };

function toChunks(rows: ChatRow[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const row of rows) {
    if (row.kind === 'user' || row.kind === 'note') {
      chunks.push({ kind: row.kind, row } as Chunk);
      continue;
    }
    const last = chunks[chunks.length - 1];
    if (last?.kind === 'agent') last.rows.push(row);
    else chunks.push({ kind: 'agent', rows: [row] });
  }
  return chunks;
}

export function SessionThread({ repoId, session, events, loading, error }: {
  repoId: string;
  session: SessionIndexEntry;
  /** Snapshot + live tail, already merged (see `useSessionEvents`). */
  events: readonly SessionEvent[];
  loading: boolean;
  error: string | null;
}) {
  const rows = toChatRows(events);
  const running = session.status === 'running' || session.status === 'waiting';

  // Conflict verdicts + the derived conflicts list, read once a finding card
  // with a dispute is on screen: the cards show recorded resolutions, record
  // new ones in place, and link each dispute to its EXACT Coverage record.
  const hasDispute = rows.some((r) => r.kind === 'finding' && r.finding.dispute !== undefined);
  const [resolutions, setResolutions] = useState<SpecConflictResolution[] | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRecord[] | null>(null);
  useEffect(() => {
    if (!hasDispute || resolutions !== null) return;
    let cancelled = false;
    api
      .getSpecCorpus(repoId)
      .then((res) => {
        if (cancelled) return;
        setResolutions(res?.conflictResolutions ?? []);
        setConflicts(
          res
            ? buildCorpusConflicts(res.corpus, {
                manualExcludes: res.manualExcludes ?? [],
                conflictResolutions: res.conflictResolutions ?? [],
              })
            : [],
        );
      })
      .catch(() => {
        if (!cancelled) {
          setResolutions([]);
          setConflicts([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasDispute, resolutions, repoId]);

  const applyAck = (res: object): void => {
    const list = (res as { conflictResolutions?: SpecConflictResolution[] }).conflictResolutions;
    if (list) setResolutions(list);
  };
  const resolveCtx: FindingResolveCtx = {
    resolutions,
    resolve: async (d, verdict) =>
      applyAck(await api.postSpecConflictResolution(repoId, { ...d, verdict })),
    undo: async (d) =>
      applyAck(
        await api.deleteSpecConflictResolution(repoId, {
          docA: d.docA,
          anchorA: d.anchorA,
          docB: d.docB,
          anchorB: d.anchorB,
        }),
      ),
    // Link the dispute's EXACT Coverage record: match against the same derived
    // conflicts list that page renders (a hand-minted pair-form id would land
    // on the pair's FIRST dispute, which can be a sibling without the review).
    // Treating the dispute as a resolution-like reuses the canonical identity
    // matcher. No match yet (corpus not folded, mid-run) → the Coverage tab.
    coverageHref: (d) => {
      const match = (conflicts ?? []).find((c) =>
        resolutionForConflict([{ ...d, verdict: 'a' }], c.a, c.b, c.overlap.sections),
      );
      return match ? `?tab=coverage&gconf=${encodeURIComponent(match.id)}` : '?tab=coverage';
    },
  };

  // The live status bubble: while the agent works, its in-flight action (or a
  // plain "Working") stands as the newest message.
  const lastRow = rows[rows.length - 1];
  const workingText =
    running && !(lastRow?.kind === 'action' && lastRow.inFlight)
      ? session.status === 'waiting'
        ? "I'm waiting on an answer to my question above."
        : "Still working. I'll post updates here as I go …"
      : null;

  const chunks = toChunks(rows);

  return (
    <FindingResolveContext.Provider value={resolveCtx}>
      <div className="min-w-0 space-y-3 border-l border-border py-2 pl-3">
        {error ? (
          <p className="text-xs text-red-500">{error}</p>
        ) : loading && rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Loading conversation…</p>
        ) : rows.length === 0 && !running ? (
          <p className="text-xs text-muted-foreground">
            The conversation appears once the session starts.
          </p>
        ) : (
          <>
            {chunks.map((chunk) =>
              chunk.kind === 'agent' ? (
                <div key={rowKey(chunk.rows[0])} className="flex max-w-[92%] gap-2.5">
                  <Avatar />
                  <div className="flex min-w-0 flex-col gap-1.5">
                    {chunk.rows.map((row) => (
                      <AgentBlock key={rowKey(row)} row={row} />
                    ))}
                  </div>
                </div>
              ) : chunk.kind === 'user' ? (
                <div key={rowKey(chunk.row)} className="ml-auto flex max-w-[92%] flex-col items-end gap-0.5">
                  <span className="text-[10px] text-muted-foreground/80">{chunk.row.label ?? 'You'}</span>
                  <div className="w-fit max-w-full rounded-xl rounded-tr border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                    {chunk.row.text}
                  </div>
                </div>
              ) : (
                <p
                  key={rowKey(chunk.row)}
                  className={`pl-9 text-[10px] ${chunk.row.tone === 'warn' ? 'text-amber-500' : 'text-muted-foreground/80'}`}
                >
                  {chunk.row.text}
                </p>
              ),
            )}
            {workingText && (
              <div className="flex max-w-[92%] gap-2.5">
                <Avatar live />
                <div className={`${AGENT_BUBBLE} text-muted-foreground`}>{workingText}</div>
              </div>
            )}
          </>
        )}
      </div>
    </FindingResolveContext.Provider>
  );
}
