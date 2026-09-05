/**
 * Sources: a flat table of the repository's documentation sites, the way
 * Repositories lists repositories, with Add source as the page action. A row
 * opens the site as its own page (`/sources/:sourceId`, see ./SourcePage.tsx):
 * its pages and the snapshot, never a third nested column.
 *
 * A CONNECTED repository reads and edits the sources its server stores, and
 * re-reads them when a source write of it lands on the socket (an add from
 * another tab, a CLI refresh); a fixture repository reads its fixtures.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SpecSourceProvider, createRepoSpecSource } from '@/components/spec/spec-source';
import { PageHeader } from '@/preview/ui/bits';
import { SpecSourceAddForm } from '@/preview/vendor/components/spec/SpecSourceAddForm';
import { useSpecSources } from '@/preview/vendor/hooks/useSpecSources';
import { formatGuardTime } from '@/preview/vendor/lib/guard-drifts';
import { pageCount } from '@/preview/vendor/lib/spec-web-source';
import { createPreviewSpecSource } from '@/preview/data/fake-api';
import type { Repo } from '@/preview/data/types';
import { useGuardRefresh } from './use-guard-refresh';
import { useGuardTabJump } from './tab-jump';

function SourcesBody({ repo }: { repo: Repo }) {
  useGuardTabJump();
  const navigate = useNavigate();
  const reloadKey = useGuardRefresh(repo, ['sources']);
  const { sources, error, refetch } = useSpecSources(repo.id, true, reloadKey);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');

  const all = sources ?? [];
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((s) => !q || s.title.toLowerCase().includes(q) || s.llmsTxtUrl.toLowerCase().includes(q));
  }, [all, query]);

  const openSite = (id: string) => navigate(`/preview/repos/${repo.id}/sources/${encodeURIComponent(id)}`);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Sources"
        subtitle={rows.length === all.length ? `${all.length}` : `${rows.length} of ${all.length}`}
        right={
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Add source
          </button>
        }
      />
      <div className="flex shrink-0 items-center gap-6 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search sources"
          placeholder="Search sources"
          className="w-64 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="px-6 py-8 text-center text-[13px] text-muted-foreground">{error}</p>
        ) : (
          <table className="w-full border-collapse text-[13px]" aria-label="Documentation sites">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-2 text-left font-semibold">Site</th>
                <th className="px-3 py-2 text-left font-semibold">llms.txt</th>
                <th className="px-3 py-2 text-right font-semibold">Pages kept</th>
                <th className="px-3 py-2 text-right font-semibold">Skipped</th>
                <th className="px-6 py-2 text-left font-semibold">Fetched</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  tabIndex={0}
                  onClick={() => openSite(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') openSite(s.id);
                  }}
                  className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                >
                  <td className="px-6 py-2.5 text-foreground">{s.title}</td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-muted-foreground">{s.llmsTxtUrl}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{pageCount(s.docCount)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{s.skipped.length}</td>
                  <td className="px-6 py-2.5 text-muted-foreground">{formatGuardTime(s.fetchedAt)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    {sources === null ? 'Loading sources.' : all.length === 0 ? 'No documentation site yet.' : 'No site matches.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a documentation site</DialogTitle>
          </DialogHeader>
          <SpecSourceAddForm
            repoId={repo.id}
            onAdded={async (id) => {
              setAdding(false);
              await refetch();
              openSite(id);
            }}
            onCancel={() => setAdding(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SourcesTab({ repo }: { repo: Repo }) {
  const source = useMemo(
    () => (repo.real ? createRepoSpecSource(repo.id) : createPreviewSpecSource(repo.id)),
    [repo.id, repo.real],
  );
  return (
    <SpecSourceProvider source={source}>
      <SourcesBody repo={repo} />
    </SpecSourceProvider>
  );
}
