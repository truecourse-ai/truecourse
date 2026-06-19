/**
 * Canonical-spec browser — presentation-only. Tree data is owned by
 * the top-level `useCanonicalSpecTree` hook in RepoPage so it
 * survives tab switches. Single-click in the tree opens a transient
 * tab in the right pane; double-click pins it.
 *
 * The tree shows modules + their topic sections (endpoints, auth, etc.)
 * with claim counts per section. Selecting a section loads its claims
 * from `claims.json` and renders them client-side.
 */

import { useState } from 'react';
import { Loader2, AlertCircle, Folder, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import type { CanonicalSpecModule, CanonicalSpecTree } from '@/lib/api';

interface SpecCanonicalPanelProps {
  tree: CanonicalSpecTree | null;
  isLoading: boolean;
  error: string | null;
  activePath: string | null;
  /** Single-click opens a transient tab; double-click pins it. */
  onOpen: (path: string, pinned: boolean) => void;
  /** False for hosted (EE): no in-dashboard Scan button — the scan is server-side. */
  supportsRescan?: boolean;
}

export function SpecCanonicalPanel({
  tree,
  isLoading,
  error,
  activePath,
  onOpen,
  supportsRescan = true,
}: SpecCanonicalPanelProps) {
  if (isLoading && !tree) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <span>{error}</span>
      </div>
    );
  }
  if (!tree || !tree.hasCanonical) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <FileText className="h-6 w-6" />
        <div>
          <div className="font-semibold">No canonical spec yet</div>
          <div className="mt-1 text-xs">
            {supportsRescan ? (
              <>
                Click <strong>Scan</strong> to discover docs and build the
                canonical claim set.
              </>
            ) : (
              <>
                The canonical claim set is built automatically when this
                repository is scanned.
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 py-1">
      {tree.modules.map((m) => (
        <ModuleGroup key={m.name} module={m} activePath={activePath} onOpen={onOpen} />
      ))}
    </div>
  );
}

function ModuleGroup({
  module,
  activePath,
  onOpen,
}: {
  module: CanonicalSpecModule;
  activePath: string | null;
  onOpen: (path: string, pinned: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const childActive = module.topics.some((t) => activePath === `${module.name}/${t.topic}`);
  const subtitle = moduleSubtitle(module.manifest);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-border bg-card px-3 py-1.5 text-left text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className={`flex-1 truncate ${childActive ? 'text-foreground' : ''}`}>{module.name}</span>
        {module.inherited && (
          <span
            className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[8px] font-medium tracking-wider text-primary"
            title="Every claim here is inherited from workspace Knowledge"
          >
            workspace
          </span>
        )}
      </button>
      {open && (
        <div>
          {subtitle && (
            <div className="px-3 pb-1 pl-9 text-[10px] text-muted-foreground/70">{subtitle}</div>
          )}
          {module.topics.map((t) => {
            const path = `${module.name}/${t.topic}`;
            const isActive = activePath === path;
            return (
              <button
                key={t.topic}
                type="button"
                onClick={() => onOpen(path, false)}
                onDoubleClick={() => onOpen(path, true)}
                className={`flex w-full items-center gap-1.5 px-3 py-1.5 pl-9 text-left text-[13px] transition-colors ${
                  isActive ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                }`}
                title={`${module.name} / ${t.topic} — ${t.claimCount} claim${t.claimCount === 1 ? '' : 's'}`}
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="flex-1 truncate">{t.topic}</span>
                {t.inherited && !isActive && (
                  <span
                    className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[8px] font-medium tracking-wider text-primary"
                    title="Inherited from workspace Knowledge"
                  >
                    workspace
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-muted-foreground">{t.claimCount}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function moduleSubtitle(manifest: Record<string, unknown>): string | undefined {
  const status = typeof manifest.status === 'string' ? manifest.status : null;
  const desc = typeof manifest.description === 'string' ? manifest.description : null;
  if (desc) return desc;
  return status ?? undefined;
}
