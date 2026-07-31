/**
 * The SOURCES group of the Spec corpus tree — llms.txt documentation sites
 * registered as spec docs (`truecourse spec source`).
 *
 * One row per registered site, previewable like every other tree row: a single
 * click opens the source's detail in the right pane, a double-click pins it. The
 * group header carries the one action the tree owns — "+", which opens the
 * focused add view in the same pane. Everything else about a source (its pages,
 * what the fetch passed over, refresh, remove) lives in that detail pane, so the
 * tree stays a list of names and counts.
 */

import { ChevronDown, ChevronRight, Globe, Loader2, Plus, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import { pageCount, SOURCE_ADD_KEY, sourceKey } from '@/lib/spec-web-source';
import { useSpecSources } from '@/hooks/useSpecSources';
import type { SpecSourceView } from '@/lib/api';

export function SpecSourcesGroup({
  repoId,
  activeKey,
  reloadKey = 0,
  onOpen,
}: {
  repoId: string;
  /** The active selection key, so the selected source's row highlights. */
  activeKey: string | null;
  /** Bumped on `spec:complete { kind: 'sources' }` — a re-read signal. */
  reloadKey?: number;
  onOpen: (key: string, pinned: boolean) => void;
}) {
  const { sources, error } = useSpecSources(repoId, true, reloadKey);
  const [open, setOpen] = useState(true);
  const list = sources ?? [];

  return (
    <div>
      {/* A div, not a button: the header carries its own "+" action, and a button
          inside a button is invalid. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-1.5 border-b border-border bg-card px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Globe className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">Sources</span>
        <HoverPopover content="Add a documentation site by its llms.txt URL" side="bottom" align="end">
          <button
            type="button"
            aria-label="Add source"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
              // Pinned: a half-typed add must not be evicted by the next preview
              // click, and cancelling it lands back on what was open before.
              onOpen(SOURCE_ADD_KEY, true);
            }}
            className={`shrink-0 rounded p-0.5 transition-colors hover:bg-muted hover:text-foreground ${
              activeKey === SOURCE_ADD_KEY ? 'text-primary' : ''
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </HoverPopover>
        <span>{list.length}</span>
      </div>
      {open && (
        <div>
          {error && (
            <div className="px-3 py-2">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          )}
          {sources === null && !error && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {sources !== null && list.length === 0 && !error && (
            <div className="py-4">
              <EmptyState
                icon={Globe}
                title="No sources"
                body="Add a documentation site’s llms.txt to snapshot its pages as spec docs."
              />
            </div>
          )}
          {list.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              active={activeKey === sourceKey(source.id)}
              onOpen={(pinned) => onOpen(sourceKey(source.id), pinned)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceRow({
  source,
  active,
  onOpen,
}: {
  source: SpecSourceView;
  active: boolean;
  onOpen: (pinned: boolean) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(false)}
      onDoubleClick={() => onOpen(true)}
      title={`${source.llmsTxtUrl} — click to preview, double-click to pin`}
      className={`flex w-full cursor-pointer items-start gap-1.5 px-3 py-1.5 pl-7 text-left text-[13px] transition-colors ${
        active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
      }`}
    >
      <Globe className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">{source.title}</span>
        <span className="truncate text-[10px] text-muted-foreground/70">
          {pageCount(source.docCount)}
          {source.skipped.length > 0 && ` · ${source.skipped.length} skipped`}
        </span>
      </span>
    </div>
  );
}
