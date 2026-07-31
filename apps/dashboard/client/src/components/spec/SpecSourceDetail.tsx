/**
 * SpecSourceDetail — the right-pane detail of ONE registered web source (a
 * documentation site added with `truecourse spec source add`).
 *
 * It is the whole story of that site in one pane: where it came from (its
 * llms.txt, linked out), when it was last fetched, how many pages it holds, the
 * pages themselves — each one click away from its markdown in the doc viewer —
 * and the links the fetch passed over, with the reason and the live URL.
 *
 * The two site-level actions live in the header: Refresh (refetch + reconcile the
 * snapshot) and Remove (delete the snapshot + unregister). Both stream progress
 * over `spec:progress`, so the page's shared progress popup renders the checklist
 * — this pane owns the trigger, the in-flight disable, and its own re-read.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, FileText, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/components/ui/hover-popover';
import * as api from '@/lib/api';
import type { SpecSourceDetailView, SpecSourceSkip } from '@/lib/api';
import { formatGuardTime } from '@/lib/guard-drifts';
import { SKIP_REASON } from '@/lib/spec-web-source';
import { WebSourceBadge } from './WebSourceBadge';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

export function SpecSourceDetail({
  repoId,
  sourceId,
  onOpenDoc,
  onRemoved,
  onClose,
}: {
  repoId: string;
  sourceId: string;
  /** Open one snapshotted page in the doc viewer (by its corpus ref). */
  onOpenDoc: (ref: string, pinned: boolean) => void;
  /** The source was deleted — the pane it lives in closes. */
  onRemoved: () => void;
  onClose?: () => void;
}) {
  const [source, setSource] = useState<SpecSourceDetailView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The one action in flight — both buttons are disabled while it is set. */
  const [busy, setBusy] = useState<'refresh' | 'remove' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** False once unmounted — a request in flight must not touch state after that. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.getSpecSource(repoId, sourceId);
      if (!alive.current) return;
      setSource(res.source);
      setLoadError(null);
    } catch (e) {
      if (!alive.current) return;
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [repoId, sourceId]);

  useEffect(() => {
    setSource(null);
    setLoadError(null);
    setActionError(null);
    void load();
  }, [load]);

  const refresh = async (): Promise<void> => {
    setBusy('refresh');
    setActionError(null);
    try {
      await api.refreshSpecSources(repoId, sourceId);
      await load();
    } catch (e) {
      if (alive.current) setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy('remove');
    setActionError(null);
    try {
      await api.removeSpecSource(repoId, sourceId);
      onRemoved();
    } catch (e) {
      if (alive.current) {
        setActionError(e instanceof Error ? e.message : String(e));
        setBusy(null);
      }
    }
  };

  if (loadError) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <WebSourceBadge />
          <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{source.title}</h2>
          <span className="text-[11px] text-muted-foreground">
            fetched {formatGuardTime(source.fetchedAt)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void refresh()}>
              {busy === 'refresh' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
            <HoverPopover content="Delete the snapshot and unregister the site" side="bottom" align="end">
              <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => void remove()}>
                {busy === 'remove' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Remove
              </Button>
            </HoverPopover>
            {onClose && (
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <a
          href={source.llmsTxtUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{source.llmsTxtUrl}</span>
        </a>
      </div>

      <div className="flex items-center gap-4 border-b border-border px-4 py-2">
        <Stat value={source.docs.length} label="pages kept" />
        <Stat value={source.skipped.length} label="skipped" />
      </div>

      {actionError && (
        <div className="px-4 pt-3">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 py-3">
          <div className={LABEL}>Pages</div>
          <div className="mt-1">
            {source.docs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                The last fetch wrote no page — every link its llms.txt lists was passed over.
              </p>
            ) : (
              source.docs.map((doc) => (
                <div
                  key={doc.ref}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenDoc(doc.ref, false)}
                  onDoubleClick={() => onOpenDoc(doc.ref, true)}
                  title={`${doc.path} — click to preview, double-click to pin`}
                  className="group flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted/40"
                >
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">{doc.title || doc.path}</span>
                    <span className="block truncate text-[10px] text-muted-foreground/70">{doc.path}</span>
                  </span>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${doc.title || doc.path} on the site`}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 rounded p-1 text-muted-foreground/70 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))
            )}
          </div>
        </div>

        {source.skipped.length > 0 && (
          <div className="border-t border-border px-4 py-3">
            <div className={LABEL}>Skipped ({source.skipped.length})</div>
            <ul className="mt-1 space-y-1">
              {source.skipped.map((skip) => (
                <SkippedRow key={`${skip.url}:${skip.reason}`} skip={skip} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-sm font-semibold text-foreground">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </span>
  );
}

/** One link the fetch wrote no page for: where it points, and why it was passed over. */
function SkippedRow({ skip }: { skip: SpecSourceSkip }) {
  return (
    <li className="text-[11px] text-muted-foreground">
      <a
        href={skip.url}
        target="_blank"
        rel="noreferrer"
        className="break-all text-primary hover:underline"
      >
        {skip.url}
      </a>{' '}
      — {SKIP_REASON[skip.reason] ?? skip.reason}
      {skip.detail ? ` (${skip.detail})` : ''}
    </li>
  );
}
