/**
 * The repository's Context tab: a SELECTION over the workspace's sources, and
 * the one place a repository plugs context in. ONE list of every workspace
 * source in one order, each with its Linked switch; a row never moves when it
 * is switched.
 *
 * The tab ADDS nothing — Add context is Context's own action, and this links
 * through to it. It starts no scan either: the Document scan belongs to the
 * workspace and starts on Context. Toggling a link saves the whole set
 * (`PUT /api/repos/:id/context/bindings`), which is what re-scans the workspace
 * and, through the ripple, regenerates the tests of the repositories whose
 * slice moved.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { ContextSourceView } from '@truecourse/shared';
import { getRepoContextBindings, putRepoContextBindings } from '@/lib/api';
import { Capsule, PageHeader } from '@/preview/ui/bits';
import {
  CONTEXT_SYNC_TONE,
  CONTEXT_SYNC_WORD,
  StatusWord,
} from '@/preview/ui/status-word';
import { formatRelativeTime } from '@/preview/vendor/shared/format/relative-time';
import { useContextSignal, useContextSources } from '@/preview/shell/use-context';
import { documentsHref, CONTEXT_BASE } from '@/preview/pages/context-hrefs';
import type { Repo } from '@/preview/data/types';

/** The kinds' words, as the add dialog names them. */
const KIND_LABEL: Record<string, string> = {
  repository: 'repository',
  site: 'site',
  jira: 'jira',
  confluence: 'confluence',
  'google-drive': 'google drive',
  onedrive: 'onedrive',
  notion: 'notion',
  slack: 'slack',
};

function SourceRow({
  source,
  linked,
  busy,
  onToggle,
}: {
  source: ContextSourceView;
  linked: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-border/60 px-6 py-2">
      <button
        type="button"
        role="switch"
        aria-checked={linked}
        aria-label={`${source.title} linked`}
        disabled={busy}
        onClick={onToggle}
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          linked ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-background transition-[left] ${
            linked ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </button>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <Link
            to={documentsHref({ source: source.id })}
            className="min-w-0 truncate text-[13px] font-medium text-foreground hover:underline"
          >
            {source.title}
          </Link>
          <StatusWord
            tone={CONTEXT_SYNC_TONE[source.status]}
            word={CONTEXT_SYNC_WORD[source.status]}
          />
        </span>
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Capsule>{KIND_LABEL[source.kind] ?? source.kind}</Capsule>
          <span>
            {source.docCount} document{source.docCount === 1 ? '' : 's'}
          </span>
          <span className="ml-auto shrink-0">
            {source.lastSyncAt ? formatRelativeTime(source.lastSyncAt) : 'never synced'}
          </span>
        </span>
      </span>
    </li>
  );
}

export function ContextTab({ repo }: { repo: Repo }) {
  const signal = useContextSignal();
  const { sources, error } = useContextSources(signal);
  const [linked, setLinked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    try {
      setLinked((await getRepoContextBindings(repo.id)).sourceIds);
    } catch {
      // No server to ask: the switches stay unknown rather than claiming none.
    }
  }, [repo.id]);

  useEffect(() => {
    void read();
  }, [read, signal]);

  const toggle = (sourceId: string): void => {
    if (!linked || busy) return;
    const next = linked.includes(sourceId)
      ? linked.filter((id) => id !== sourceId)
      : [...linked, sourceId];
    setLinked(next);
    setBusy(true);
    void putRepoContextBindings(repo.id, next)
      .then((res) => setLinked(res.sourceIds))
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : String(e));
        void read();
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Context"
        right={
          <Link
            to={CONTEXT_BASE}
            className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
          >
            Add context
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {/* ONE list, in one order: every workspace source with its switch. */}
        <ul aria-label="Workspace sources">
          {(sources ?? []).map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              linked={(linked ?? []).includes(source.id)}
              busy={busy || linked === null}
              onToggle={() => toggle(source.id)}
            />
          ))}
          {sources !== null && sources.length === 0 && (
            <li className="px-6 py-4 text-xs text-muted-foreground">
              No source in the workspace yet.
            </li>
          )}
          {sources === null && (
            <li className="px-6 py-4 text-xs text-muted-foreground">
              {error ? `The sources could not be read: ${error}` : 'Loading…'}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
