/**
 * The EXTERNAL SOURCES block of the Spec corpus sidebar — llms.txt documentation
 * sites registered as spec docs (`truecourse spec source`).
 *
 * One row per registered source (title, page count, last fetch) with inline
 * refresh + remove, an expandable list of the links the fetch passed over (and
 * why), and the add flow: paste the site's llms.txt URL → a preview of what would
 * be fetched → Fetch. Nothing here calls an LLM, so there is no cost estimate;
 * the pages it materializes are priced by the next Scan, whose Rescan dot lights
 * as soon as a fetch lands (the staleness probe watches the snapshot).
 *
 * The fetch itself streams progress over `spec:progress`, so the page's shared
 * progress popup renders the checklist — this block only owns the trigger, the
 * in-flight disable, and its own list refresh.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import { Input } from '@/components/ui/input';
import * as api from '@/lib/api';
import type { SpecSourcePreview, SpecSourceSkip, SpecSourceView } from '@/lib/api';

const SKIP_REASON: Record<SpecSourceSkip['reason'], string> = {
  'external-origin': 'links off this site',
  'not-markdown': 'page is not markdown',
  'fetch-failed': 'could not be fetched',
};

function pages(n: number): string {
  return `${n} page${n === 1 ? '' : 's'}`;
}

function formatFetchedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(
    undefined,
    { hour: '2-digit', minute: '2-digit' },
  )}`;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function SpecSourcesSection({ repoId }: { repoId: string }) {
  const [sources, setSources] = useState<SpecSourceView[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // null = follow the data (open once a source exists); a click pins the choice.
  const [open, setOpen] = useState<boolean | null>(null);
  /** The one action in flight — every button is disabled while it is set. */
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listSpecSources(repoId);
      setSources(res.sources);
      setListError(null);
    } catch (e) {
      setListError(message(e));
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run one source mutation, then resync the list from the server. */
  const act = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusy(key);
      setActionError(null);
      try {
        await action();
        await load();
      } catch (e) {
        setActionError(message(e));
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const list = sources ?? [];
  const expanded = open ?? list.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-border bg-card px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Globe className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">External sources</span>
        <span>{list.length}</span>
      </button>
      {expanded && (
        <div className="pb-2">
          {listError && (
            <div className="px-3 py-2">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{listError}</AlertDescription>
              </Alert>
            </div>
          )}
          {sources === null && !listError && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {sources !== null && list.length === 0 && (
            <div className="py-4">
              <EmptyState
                icon={Globe}
                title="No external sources"
                body="Add a documentation site's llms.txt below to snapshot its pages as spec docs."
              />
            </div>
          )}
          {list.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              detail={detailId === source.id}
              busy={busy}
              onToggleDetail={() => setDetailId(detailId === source.id ? null : source.id)}
              onRefresh={() => act(`refresh:${source.id}`, () => api.refreshSpecSources(repoId, source.id))}
              onRemove={() => act(`remove:${source.id}`, () => api.removeSpecSource(repoId, source.id))}
            />
          ))}
          {list.length > 1 && (
            <div className="px-3 pt-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => act('refresh:all', () => api.refreshSpecSources(repoId))}
              >
                {busy === 'refresh:all' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh all
              </Button>
            </div>
          )}
          {actionError && (
            <div className="px-3 py-2">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            </div>
          )}
          <AddSource
            repoId={repoId}
            busy={busy}
            onBusy={setBusy}
            onAdded={() => {
              setActionError(null);
              void load();
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * One registered source. Clicking the row reveals its details (the llms.txt URL
 * and the links no page was written for); the inline actions stop propagation so
 * they never toggle it.
 */
function SourceRow({
  source,
  detail,
  busy,
  onToggleDetail,
  onRefresh,
  onRemove,
}: {
  source: SpecSourceView;
  detail: boolean;
  busy: string | null;
  onToggleDetail: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const refreshing = busy === `refresh:${source.id}`;
  const removing = busy === `remove:${source.id}`;
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={detail}
        onClick={onToggleDetail}
        className="group flex w-full cursor-pointer items-start gap-1.5 px-3 py-1.5 pl-7 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <Globe className="mt-0.5 h-3 w-3 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{source.title}</span>
          <span className="truncate text-[10px] text-muted-foreground/70">
            {pages(source.docCount)} · fetched {formatFetchedAt(source.fetchedAt)}
            {source.skipped.length > 0 && ` · ${source.skipped.length} skipped`}
          </span>
        </span>
        <HoverPopover content="Refetch this site and reconcile the snapshot" side="top" align="end">
          <button
            type="button"
            aria-label={`Refresh ${source.title}`}
            disabled={busy !== null}
            onClick={(e) => {
              e.stopPropagation();
              onRefresh();
            }}
            className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
          >
            {refreshing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </button>
        </HoverPopover>
        <HoverPopover content="Delete the snapshot and unregister the site" side="top" align="end">
          <button
            type="button"
            aria-label={`Remove ${source.title}`}
            disabled={busy !== null}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
          >
            {removing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </button>
        </HoverPopover>
      </div>
      {detail && (
        <div className="space-y-1 px-3 pb-2 pl-11 text-[10px] text-muted-foreground/70">
          <a
            href={source.llmsTxtUrl}
            target="_blank"
            rel="noreferrer"
            className="block truncate hover:text-foreground hover:underline"
          >
            {source.llmsTxtUrl}
          </a>
          {source.skipped.length > 0 && (
            <SkippedList skipped={source.skipped} />
          )}
        </div>
      )}
    </div>
  );
}

/** The links a fetch wrote no page for, each with its reason. */
function SkippedList({ skipped }: { skipped: SpecSourceSkip[] }) {
  return (
    <div>
      <div className="font-medium uppercase tracking-wider">Skipped ({skipped.length})</div>
      <ul className="mt-0.5 space-y-0.5">
        {skipped.map((skip) => (
          <li key={`${skip.url}:${skip.reason}`} className="break-all">
            {skip.url} — {SKIP_REASON[skip.reason] ?? skip.reason}
            {skip.detail ? ` (${skip.detail})` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The add flow: a URL, then a PREVIEW of what the site lists, then the fetch.
 * The preview is a separate step because an add pulls a whole documentation site
 * over the network — the page count is shown before anything is written, exactly
 * like the CLI's confirm.
 */
function AddSource({
  repoId,
  busy,
  onBusy,
  onAdded,
}: {
  repoId: string;
  busy: string | null;
  onBusy: (key: string | null) => void;
  onAdded: () => void;
}) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<SpecSourcePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setPreview(null);
    setError(null);
    setUrl('');
  };

  const check = async (): Promise<void> => {
    const value = url.trim();
    if (!value) return;
    onBusy('preview');
    setError(null);
    try {
      setPreview(await api.previewSpecSource(repoId, value));
    } catch (e) {
      setPreview(null);
      setError(message(e));
    } finally {
      onBusy(null);
    }
  };

  const fetchNow = async (): Promise<void> => {
    if (!preview) return;
    onBusy('add');
    setError(null);
    try {
      await api.addSpecSource(repoId, preview.llmsTxtUrl);
      reset();
      onAdded();
    } catch (e) {
      setError(message(e));
    } finally {
      onBusy(null);
    }
  };

  const disabled = busy !== null;
  return (
    <div className="space-y-2 border-t border-border/60 px-3 pt-2">
      <div className="flex items-center gap-1.5">
        <Input
          value={url}
          disabled={disabled}
          placeholder="https://docs.example.com/llms.txt"
          aria-label="llms.txt URL"
          onChange={(e) => {
            setUrl(e.target.value);
            setPreview(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void check();
          }}
          className="h-7 text-[11px]"
        />
        <Button size="sm" variant="outline" disabled={disabled || url.trim() === ''} onClick={() => void check()}>
          {busy === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Check
        </Button>
      </div>
      {preview && (
        <div className="rounded border border-border bg-card px-2 py-1.5 text-[11px] text-muted-foreground">
          <div className="text-foreground">
            Found “{preview.title}” — {pages(preview.totalLinks)} ({preview.fetchableLinks} fetchable)
          </div>
          {preview.skipped.length > 0 && (
            <div className="mt-0.5 text-[10px] text-muted-foreground/70">
              {preview.skipped.length} link{preview.skipped.length === 1 ? '' : 's'} skipped —{' '}
              {SKIP_REASON[preview.skipped[0].reason] ?? preview.skipped[0].reason}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-1.5">
            <Button size="sm" disabled={disabled} onClick={() => void fetchNow()}>
              {busy === 'add' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Fetch
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!preview && !error && (
        <p className="text-[10px] text-muted-foreground/70">
          Only llms.txt-enabled sites — paste the file's URL directly. Pages are snapshotted into the
          repo and folded in by the next Scan.
        </p>
      )}
    </div>
  );
}
