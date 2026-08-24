/**
 * One authoring worker session, rendered as a compact conversation — the same
 * append-only JSONL whether it is still being written (live batches over the
 * `guard:transcript` socket event) or long finished (the backfill route alone).
 * One block per transcript event:
 *
 *   init    the session opened — model + the tools it was handed
 *   reply   the assistant's text (monospace, clamped past ~12 lines)
 *   tool    name + duration, args/result behind a collapsible pre
 *   reask   the malformed-turn nudge, amber
 *   outcome the delivered outcome JSON, green
 *   end     terminal status + turns + token totals (red unless `outcome`)
 *
 * The live path subscribes BEFORE the backfill fetch and merges by transcript
 * index, so overlap is idempotent and a gap cannot form. Auto-scroll follows
 * appends only while the reader is already at the bottom.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, SquareTerminal } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import * as api from '@/lib/api';
import {
  asSessionEvent,
  batchMatches,
  mergeTranscriptBatch,
  type GuardSessionEvent,
  type GuardTranscriptBatch,
} from '@/lib/guard-session';

type OnEvent = (event: string, handler: (data: unknown) => void) => () => void;

const REPLY_CLAMP_LINES = 12;
const AT_BOTTOM_SLACK_PX = 24;

const NOTE = 'text-[11px] leading-snug text-muted-foreground';

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Assistant text, clamped past ~12 lines with an inline "Show more". */
function ClampedText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const clamped = !expanded && lines.length > REPLY_CLAMP_LINES;
  const shown = clamped ? lines.slice(0, REPLY_CLAMP_LINES).join('\n') : text;
  return (
    <div>
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-foreground">
        {shown}
      </pre>
      {lines.length > REPLY_CLAMP_LINES && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-[11px] text-primary underline underline-offset-2"
        >
          {clamped ? `Show more (${lines.length - REPLY_CLAMP_LINES} more lines)` : 'Show less'}
        </button>
      )}
    </div>
  );
}

/** A labelled collapsible <pre> — the tool block's args/result body. */
function CollapsiblePre({ label, body }: { label: string; body: string }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <Chevron className="h-3 w-3 shrink-0" />
        {label}
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-[11px] leading-snug text-foreground">
          {body}
        </pre>
      )}
    </div>
  );
}

function EventBlock({ ev }: { ev: GuardSessionEvent }) {
  switch (ev.kind) {
    case 'init':
      return (
        <div className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
          <div className={NOTE}>
            Session {ev.resumed ? 'resumed' : 'opened'}
            {ev.model ? ` · ${ev.model}` : ''}
            {ev.tools.length > 0 ? ` · tools: ${ev.tools.join(', ')}` : ''}
          </div>
        </div>
      );
    case 'reply':
      return (
        <div className="rounded border border-border/60 px-2 py-1.5">
          <div className={`${NOTE} mb-1`}>
            assistant · turn {ev.turn}
            {ev.toolCall ? ` · calls ${ev.toolCall.name}` : ''}
          </div>
          <ClampedText text={ev.text} />
        </div>
      );
    case 'tool':
      return (
        <div className="rounded border border-border/60 bg-muted/10 px-2 py-1.5">
          <div className={`${NOTE} mb-1`}>
            <span className="font-mono text-foreground">{ev.name}</span> · {ev.durationMs} ms
          </div>
          <div className="space-y-1">
            <CollapsiblePre label="args" body={json(ev.args)} />
            <CollapsiblePre label="result" body={ev.result} />
          </div>
        </div>
      );
    case 'reask':
      return (
        <div className="rounded border border-amber-500/40 bg-amber-500/[0.07] px-2 py-1.5">
          <div className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
            Re-asked · {ev.detail}
          </div>
        </div>
      );
    case 'outcome':
      return (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/[0.07] px-2 py-1.5">
          <div className="mb-1 text-[11px] leading-snug text-emerald-700 dark:text-emerald-400">
            Outcome · turn {ev.turn}
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-foreground">
            {json(ev.outcome)}
          </pre>
        </div>
      );
    case 'end': {
      const ok = ev.status === 'outcome';
      return (
        <div
          className={`rounded border px-2 py-1.5 ${
            ok ? 'border-emerald-500/40 bg-emerald-500/[0.07]' : 'border-red-500/40 bg-red-500/[0.07]'
          }`}
        >
          <div
            className={`text-[11px] leading-snug ${
              ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
            }`}
          >
            Session ended · {ev.status} · {ev.turns} turn{ev.turns === 1 ? '' : 's'} ·{' '}
            {ev.usage.inputTokens.toLocaleString()} in / {ev.usage.outputTokens.toLocaleString()} out tokens
            {ev.detail ? ` · ${ev.detail}` : ''}
          </div>
        </div>
      );
    }
  }
}

export function GuardSessionTranscript({
  repoId,
  runId,
  flowId,
  surface,
  onEvent,
}: {
  repoId: string;
  runId: string;
  flowId: string;
  surface: string;
  /** The socket fan-out (`useSocket().onEvent`); omitted = backfill only. */
  onEvent?: OnEvent;
}) {
  // Sparse, indexed by transcript line — backfill and live batches land on the
  // same slots, so arrival order does not matter.
  const [slots, setSlots] = useState<(unknown | undefined)[]>([]);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const apply = useCallback((seq: number, events: readonly unknown[]) => {
    setSlots((prev) => mergeTranscriptBatch(prev, seq, events));
  }, []);

  useEffect(() => {
    // Subscribe before fetching: an overlap merges idempotently by index.
    const unsubscribe = onEvent?.('guard:transcript', (data) => {
      const batch = data as Partial<GuardTranscriptBatch>;
      if (!batchMatches(batch, runId, flowId, surface)) return;
      apply(batch.seq, batch.events);
    });
    let cancelled = false;
    api
      .getGuardTranscript(repoId, runId, flowId, surface)
      .then((r) => {
        if (cancelled) return;
        apply(0, r.events);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [repoId, runId, flowId, surface, onEvent, apply]);

  const events = useMemo(() => slots.filter((s): s is unknown => s !== undefined), [slots]);

  // Follow appends only while the reader is already at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  if (!loaded && events.length === 0) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="py-4">
        <EmptyState
          icon={SquareTerminal}
          title="No session yet"
          body="The worker has not written a transcript line for this surface."
        />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_SLACK_PX;
      }}
      className="max-h-96 space-y-1.5 overflow-y-auto px-3 py-2"
      role="log"
      aria-label="Worker session transcript"
    >
      {events.map((raw, i) => {
        const ev = asSessionEvent(raw);
        return ev ? (
          <EventBlock key={i} ev={ev} />
        ) : (
          // A line this build does not recognize still shows — raw, never dropped.
          <pre
            key={i}
            className="whitespace-pre-wrap break-words rounded border border-border/60 px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground"
          >
            {json(raw)}
          </pre>
        );
      })}
    </div>
  );
}
