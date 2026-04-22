import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, Check, X, FileText, AlertTriangle } from 'lucide-react';
import * as api from '@/lib/api';
import type { AdrDraftResponse, AdrListItem } from '@/lib/api';
import { useAdrs } from '@/hooks/useAdrs';

type DecisionsPanelProps = {
  repoId: string;
  /** Called when a draft row is interacted with. `pinned=false` for single
   *  click (preview slot), `pinned=true` for double click (pinned tab).
   *  Matches FileTree / FlowList conventions. */
  onOpenDraft: (draft: AdrDraftResponse, pinned: boolean) => void;
  onOpenAdr: (adr: AdrListItem, pinned: boolean) => void;
  /** Composite key of the active main-area tab, if any. Used to highlight the
   *  matching row. Shape: `draft:<id>` or `adr:<id>`. */
  activeTabKey?: string | null;
  /** Parent bumps this after accept/reject to force a refetch so the sidebar
   *  list reflects the server change without relying on socket events. */
  refreshKey?: number;
};

type SuggestProgressPayload = {
  repoId: string;
  runId: string;
  event: { kind: string; [k: string]: unknown };
};

export function DecisionsPanel({
  repoId,
  onOpenDraft,
  onOpenAdr,
  activeTabKey,
  refreshKey,
}: DecisionsPanelProps) {
  const { adrs, drafts, isLoading, error, refetch } = useAdrs(repoId, { refreshKey });

  const [runState, setRunState] = useState<
    | { kind: 'idle' }
    | { kind: 'running'; runId: string; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // --- Suggest run lifecycle -------------------------------------------------

  const startSuggest = useCallback(async () => {
    try {
      setRunState({ kind: 'running', runId: '', message: 'Starting survey…' });
      const { runId } = await api.suggestAdrs(repoId);
      setRunState({
        kind: 'running',
        runId,
        message: 'Surveying the graph for undocumented decisions…',
      });
    } catch (err) {
      setRunState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [repoId]);

  // --- Socket.io listener for run progress ----------------------------------

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let mounted = true;
    let cleanup: (() => void) | null = null;

    (async () => {
      const { getSocket } = await import('@/lib/socket');
      const socket = getSocket();
      socket.emit('joinRepo', repoId);

      const handler = (payload: SuggestProgressPayload) => {
        if (!mounted) return;
        if (payload.repoId !== repoId) return;
        const { event } = payload;
        switch (event.kind) {
          case 'survey-done':
            setRunState({
              kind: 'running',
              runId: payload.runId,
              message: `Survey done — ${(event.afterFilter as number) ?? 0} candidates surviving filter`,
            });
            break;
          case 'draft-start':
            setRunState({
              kind: 'running',
              runId: payload.runId,
              message: `Drafting: ${(event.topic as string) ?? '…'}`,
            });
            break;
          case 'draft-done':
            refetch();
            setRunState({
              kind: 'running',
              runId: payload.runId,
              message: 'Draft landed — continuing…',
            });
            break;
          case 'complete':
            refetch();
            setRunState({ kind: 'idle' });
            break;
          default:
            break;
        }
      };

      socket.on('adr:suggest:progress', handler);
      cleanup = () => {
        socket.off('adr:suggest:progress', handler);
        socket.emit('leaveRepo', repoId);
      };
    })();

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [repoId, refetch]);

  // --- Render ---------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={startSuggest}
          disabled={runState.kind === 'running'}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {runState.kind === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {runState.kind === 'running' ? 'Suggesting…' : 'Suggest undocumented decisions'}
        </button>
        {runState.kind === 'running' && (
          <div className="mt-1 truncate text-[10px] text-muted-foreground">{runState.message}</div>
        )}
        {runState.kind === 'error' && (
          <div className="mt-1 truncate text-[10px] text-destructive">{runState.message}</div>
        )}
      </div>

      {isLoading ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="p-3 text-xs text-destructive">{error}</div>
      ) : (
        <div className="flex-1 overflow-auto">
          <Section
            title={`Review queue${drafts.length ? ` (${drafts.length})` : ''}`}
            empty={drafts.length === 0 ? 'No drafts. Click "Suggest" above to generate some.' : null}
          >
            {drafts.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                isActive={activeTabKey === `draft:${draft.id}`}
                onSelect={() => onOpenDraft(draft, false)}
                onPin={() => onOpenDraft(draft, true)}
              />
            ))}
          </Section>

          <Section
            title={`Accepted${adrs.length ? ` (${adrs.length})` : ''}`}
            empty={adrs.length === 0 ? 'No accepted ADRs yet.' : null}
          >
            {adrs.map((adr) => (
              <AdrRow
                key={adr.id}
                adr={adr}
                isActive={activeTabKey === `adr:${adr.id}`}
                onSelect={() => onOpenAdr(adr, false)}
                onPin={() => onOpenAdr(adr, true)}
              />
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational subcomponents
// ---------------------------------------------------------------------------

function Section(props: { title: string; empty: string | null; children: React.ReactNode }) {
  const hasContent = Array.isArray(props.children)
    ? (props.children as unknown[]).length > 0
    : props.children != null;

  return (
    <div className="border-b border-border">
      <div className="sticky top-0 z-10 bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {props.title}
      </div>
      {hasContent ? (
        <div className="flex flex-col">{props.children}</div>
      ) : (
        <div className="px-3 py-2 text-xs text-muted-foreground/70">{props.empty}</div>
      )}
    </div>
  );
}

function DraftRow(props: {
  draft: AdrDraftResponse;
  isActive: boolean;
  onSelect: () => void;
  onPin: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      onDoubleClick={props.onPin}
      className={`flex flex-col gap-1 border-b border-border/50 px-3 py-2 text-left hover:bg-muted/30 ${props.isActive ? 'bg-muted/40' : ''}`}
    >
      <div className="text-sm font-medium text-foreground">{props.draft.title}</div>
      <div className="text-[11px] text-muted-foreground">
        {props.draft.topic} · confidence {props.draft.confidence.toFixed(2)}
      </div>
      {props.draft.entities.length > 0 && (
        <div className="text-[11px] text-muted-foreground/80">
          {props.draft.entities.join(', ')}
        </div>
      )}
    </button>
  );
}

function AdrRow(props: {
  adr: AdrListItem;
  isActive: boolean;
  onSelect: () => void;
  onPin: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      onDoubleClick={props.onPin}
      className={`flex flex-col gap-0.5 border-b border-border/50 px-3 py-2 text-left hover:bg-muted/30 ${props.isActive ? 'bg-muted/40' : ''}`}
    >
      <div className="flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{props.adr.id}</span>
        {props.adr.isStale && (
          <span className="flex items-center gap-0.5 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
            <AlertTriangle className="h-3 w-3" /> stale
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">{props.adr.title}</div>
      <div className="text-[10px] text-muted-foreground/70">
        {props.adr.status} · {props.adr.linkedNodeIds.length} linked
      </div>
    </button>
  );
}

// Exported so the main-area AdrViewerPanel can render the Accept/Reject
// buttons with the same styling.
export { Check, X };
