/**
 * Contracts sidebar — presentation-only. Tree data is owned by the
 * top-level `useContractsTree` hook in RepoGraphPage so it survives
 * tab switches. Single-click in the tree opens a transient tab in
 * the right pane; double-click pins it.
 */

import { useState } from 'react';
import { Loader2, AlertCircle, Folder, FileCode2, ChevronRight, ChevronDown } from 'lucide-react';
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
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <FileCode2 className="h-6 w-6" />
        <div>
          <div className="font-semibold">No contracts yet</div>
          <div className="mt-1 text-xs">
            Resolve all open conflicts in <strong>Spec</strong> and click{' '}
            <strong>Apply</strong> — contracts are generated from the canonical
            spec.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-auto py-1">
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
        <span className="ml-auto text-[10px] text-muted-foreground/60">{files.length}</span>
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
              className={`flex w-full items-center gap-1.5 px-3 py-1.5 pl-9 text-left text-xs transition-colors ${
                isActive ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
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
