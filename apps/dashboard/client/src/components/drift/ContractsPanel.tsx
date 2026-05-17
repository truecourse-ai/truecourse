/**
 * Contracts sidebar — presentation-only. Tree data is owned by the
 * top-level `useContractsTree` hook in RepoGraphPage so it survives
 * tab switches. Single-click in the tree opens a transient tab in
 * the right pane; double-click pins it.
 */

import { useState } from 'react';
import { Loader2, AlertCircle, Folder, FileCode2, ChevronRight, ChevronDown } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import type { ContractsTree } from '@/lib/api';

interface ContractsPanelProps {
  tree: ContractsTree | null;
  isLoading: boolean;
  error: string | null;
  activePath: string | null;
  /** Single-click opens a transient tab; double-click pins it. */
  onOpen: (path: string, pinned: boolean) => void;
}

export function ContractsPanel({ tree, isLoading, error, activePath, onOpen }: ContractsPanelProps) {
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
  if (!tree || !tree.hasContracts) {
    return (
      <EmptyState
        icon={FileCode2}
        title="No contracts yet"
        body={
          <>
            Resolve all open conflicts in <strong>Spec</strong>, click{' '}
            <strong>Apply</strong>, then click <strong>Generate</strong> here to
            extract TC contracts.
          </>
        }
      />
    );
  }

  return (
    <div className="h-full overflow-auto">
      {tree.modules.map((m) => (
        <ModuleGroup
          key={m.name}
          label={m.name}
          files={m.files}
          activePath={activePath}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function ModuleGroup({
  label,
  files,
  activePath,
  onOpen,
}: {
  label: string;
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
        className={`sticky top-0 z-10 flex w-full items-center justify-between gap-2 border-b border-border bg-card/80 px-4 py-1.5 text-left text-[10px] uppercase tracking-wider hover:text-foreground ${
          childActive ? 'text-foreground' : 'text-muted-foreground'
        }`}
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <Folder className="h-3 w-3 shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        <span>{files.length}</span>
      </button>
      {open &&
        files.map((f) => {
          const isActive = f.path === activePath;
          // Strip the module-name prefix from the display name so the
          // sidebar shows the operation/entity name, not a redundant
          // `orders/operations/get-api-orders.tc`.
          const display = f.path.replace(/^[^/]+\//, '');
          return (
            <button
              key={f.path}
              type="button"
              onClick={() => onOpen(f.path, false)}
              onDoubleClick={() => onOpen(f.path, true)}
              className={`flex w-full items-center gap-2 border-b border-border/60 px-4 py-2 pl-9 text-left text-xs transition-colors ${
                isActive
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }`}
              title={`${f.path} — click to preview, double-click to pin`}
            >
              <FileCode2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{display}</span>
            </button>
          );
        })}
    </div>
  );
}
