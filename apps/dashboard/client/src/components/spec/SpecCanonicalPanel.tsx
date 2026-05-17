/**
 * Canonical-spec browser — presentation-only. Tree data is owned by
 * the top-level `useCanonicalSpecTree` hook in RepoGraphPage so it
 * survives tab switches. Single-click in the tree opens a transient
 * tab in the right pane; double-click pins it.
 */

import { useState } from 'react';
import { Loader2, AlertCircle, Folder, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import type { CanonicalSpecTree } from '@/lib/api';

interface SpecCanonicalPanelProps {
  tree: CanonicalSpecTree | null;
  isLoading: boolean;
  error: string | null;
  activePath: string | null;
  /** Single-click opens a transient tab; double-click pins it. */
  onOpen: (path: string, pinned: boolean) => void;
}

export function SpecCanonicalPanel({ tree, isLoading, error, activePath, onOpen }: SpecCanonicalPanelProps) {
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
            Resolve any open conflicts and click <strong>Apply</strong> to
            materialize the canonical spec.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-auto py-1">
      {tree.shared.length > 0 && (
        <FolderGroup
          label="shared"
          subtitle="cross-cutting"
          files={tree.shared}
          activePath={activePath}
          onOpen={onOpen}
        />
      )}
      {tree.modules.map((m) => (
        <FolderGroup
          key={m.name}
          label={m.name}
          subtitle={moduleSubtitle(m.manifest)}
          files={m.files}
          activePath={activePath}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function moduleSubtitle(manifest: Record<string, unknown> | null): string | undefined {
  if (!manifest) return undefined;
  const status = typeof manifest.status === 'string' ? manifest.status : null;
  const desc = typeof manifest.description === 'string' ? manifest.description : null;
  if (desc) return desc;
  return status ?? undefined;
}

function FolderGroup({
  label,
  subtitle,
  files,
  activePath,
  onOpen,
}: {
  label: string;
  subtitle?: string;
  files: Array<{ name: string; path: string }>;
  activePath: string | null;
  onOpen: (path: string, pinned: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const childActive = files.some((f) => f.path === activePath);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className={`flex-1 truncate ${childActive ? 'text-foreground' : ''}`}>{label}</span>
      </button>
      {open && (
        <div>
          {subtitle && (
            <div className="px-3 pb-1 pl-9 text-[10px] text-muted-foreground/70">{subtitle}</div>
          )}
          {files.map((f) => {
            const isActive = f.path === activePath;
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => onOpen(f.path, false)}
                onDoubleClick={() => onOpen(f.path, true)}
                className={`flex w-full items-center gap-1.5 px-3 py-1.5 pl-9 text-left text-xs transition-colors ${
                  isActive ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                }`}
                title={`${f.path} — click to preview, double-click to pin`}
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
