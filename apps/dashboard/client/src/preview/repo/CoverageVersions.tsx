/**
 * The coverage VERSION picker, the first row of the Corpus panel: the current
 * version on one line (its label, its commit, a chevron), opening a dialog with
 * the shared list of every version (the baseline on the default branch, then one
 * per pull request that changed spec documents), searchable, any count. The
 * chosen version rides `?version=` so a run's "coverage" link and a shared
 * address land on the same reading.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EntityList } from '@/preview/ui/entity-list';
import { coverageVersions, type CoverageVersion } from '@/preview/data/corpus';
import type { Repo } from '@/preview/data/types';
import { usePreviewState } from '@/preview/shell/preview-state';

export function useCoverageVersion(repoId: string): {
  version: CoverageVersion | undefined;
  versions: CoverageVersion[];
  select: (id: string | null) => void;
} {
  const [params, setParams] = useSearchParams();
  const versions = coverageVersions(repoId);
  const id = params.get('version');
  const version = (id ? versions.find((v) => v.id === id) : undefined) ?? versions[0];
  const select = (next: string | null) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      // The baseline is the default: no param. A version swap closes the open docs,
      // which belong to the version they were opened in.
      if (!next || next === versions[0]?.id) p.delete('version');
      else p.set('version', next);
      p.delete('doc');
      p.delete('conflict');
      p.delete('section');
      return p;
    });
  return { version, versions, select };
}

export function CoverageVersionPicker({
  repo,
  versions,
  version,
  onSelect,
}: {
  repo: Repo;
  versions: CoverageVersion[];
  version: CoverageVersion | undefined;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { generatedVersions, regenerateVersion } = usePreviewState();
  if (versions.length < 2 || !version) return null;
  const generated = version.generated || generatedVersions.has(version.id);
  return (
    <>
      <div className="flex w-full shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="text-[11px] text-muted-foreground">Version</span>
          <span className="text-[13px] text-foreground">{version.label}</span>
          <span className="font-mono text-[12px] text-muted-foreground">{version.sha}</span>
          {!generated && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-foreground">
              <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" />
              Not generated
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground hover:text-foreground">Change</span>
        </button>
        {!generated && version.pullRequest != null && (
          <button
            type="button"
            onClick={() => regenerateVersion(repo, version.id, version.label)}
            className="shrink-0 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
          >
            Regenerate and re-gate
          </button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[70vh] flex-col p-0 sm:max-w-lg">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>Coverage versions</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <EntityList<CoverageVersion>
              label="Coverage versions"
              items={versions}
              itemId={(v) => v.id}
              activeId={version.id}
              onOpen={(id) => {
                onSelect(id);
                setOpen(false);
              }}
              search={{
                placeholder: 'Search versions',
                ariaLabel: 'Search versions',
                match: (v, q) =>
                  v.label.toLowerCase().includes(q) || v.sha.includes(q) || v.ref.toLowerCase().includes(q),
              }}
              renderRow={(v) => (
                <>
                  <span className="flex w-full items-center gap-2">
                    <span className="text-[13px] text-foreground">{v.label}</span>
                    <span className="font-mono text-[12px] text-muted-foreground">{v.sha}</span>
                    <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium text-foreground">
                      <span aria-hidden className={`h-2 w-2 rounded-full ${v.generated || generatedVersions.has(v.id) ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      {v.generated || generatedVersions.has(v.id) ? 'Generated' : 'Not generated'}
                    </span>
                  </span>
                  <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate font-mono">{v.ref}</span>
                    <span className="ml-auto shrink-0">{v.createdAt}</span>
                  </span>
                </>
              )}
              emptyText="No version yet."
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
