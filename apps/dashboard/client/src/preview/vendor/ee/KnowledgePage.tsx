// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's ee/packages/client/src/KnowledgePage.tsx with imports retargeted; delete with the preview.
/**
 * Workspace Knowledge , the enterprise console surface for the cross-repo spec
 * corpus derived from connected tools (Confluence / Jira / …) via Sync + Process.
 *
 * It reuses the REAL repo corpus components (`SpecCorpusView` /
 * `SpecOverlapDetail` / `SpecDocViewer`) unchanged, wrapping the Spec tab in a
 * `SpecSourceProvider` backed by a WORKSPACE data source (`/api/ee/knowledge/
 * spec/*`) instead of a repo one. The workspace source hides the on-demand Scan
 * (content arrives from connector syncs) and pages the "Not included" listing for
 * scale.
 *
 * The workspace level keeps ONLY specs + conflict resolution , repos generate their
 * guard scenarios from the union of workspace + repo specs, so there is no
 * workspace-level Scenarios tab.
 *
 * Tabs:
 *   - Spec (default): areas → kept docs + conflicts; the right pane opens each in
 *     the house preview/pin tab strip (single-click preview, double-click pin,
 *     `?spec=`-synced) , a doc opens the markdown viewer, a conflict the resolution
 *     detail. Force-include / exclude + pick-a-side verdicts all hit the workspace
 *     decision endpoints.
 *   - Sources: the provenance ledger (server-paginated, searchable, kind-filtered).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Database, FileText, GitMerge, Loader2, Search } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { CHIP_CLASS } from '@/preview/ui/bits';
import { FilterBar } from '@/preview/ui/filter-bar';
import { formatRelativeTime } from '@/preview/vendor/shared/format/relative-time';
import { SpecCorpusView, useSpecCorpus, parseSpecKey } from '@/preview/vendor/components/spec/SpecCorpusView';
import { SpecOverlapDetail } from '@/preview/vendor/components/spec/SpecOverlapDetail';
import { SpecDocViewer } from '@/preview/vendor/components/spec/SpecDocViewer';
import { SpecSourceProvider } from '@/components/spec/spec-source';
import { GuardTabStrip, type GuardTabStripItem } from '@/preview/vendor/components/guard/GuardTabStrip';
import { useGuardTabs } from '@/preview/vendor/hooks/useGuardTabs';
import { buildCorpusConflicts, resolveConflictId } from '@/preview/vendor/shared';
import { createWorkspaceSpecSource } from '@/preview/data/fake-api';

// The EE client's JSON reader, over the preview fetch shim.
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

type Tab = 'spec' | 'sources';

const TABS: Array<{ id: Tab; label: string; icon: typeof BookOpen }> = [
  { id: 'spec', label: 'Spec', icon: FileText },
  { id: 'sources', label: 'Sources', icon: Database },
];

export default function KnowledgePage() {
  const source = useMemo(() => createWorkspaceSpecSource(), []);
  const [tab, setTab] = useState<Tab>('spec');

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <BookOpen className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Knowledge</h1>
          <p className="text-xs text-muted-foreground">
            Workspace spec corpus, shared by every repo , curated from your connected sources.
          </p>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-border px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1">
        {tab === 'spec' && (
          <SpecSourceProvider source={source}>
            <KnowledgeSpecTab />
          </SpecSourceProvider>
        )}
        {tab === 'sources' && <SourcesTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spec , the reused corpus view + doc/conflict detail, over the workspace source.
// ---------------------------------------------------------------------------

function KnowledgeSpecTab() {
  const corpus = useSpecCorpus('ws', true);
  // The shared preview/pin tab model (single-click preview, double-click pin),
  // `?spec=`-synced , the same reducer + strip the repo Spec views use.
  const { activeId, openTabs, open, close } = useGuardTabs('spec', 'ws');
  const sel = useMemo(() => (activeId ? parseSpecKey(activeId) : null), [activeId]);
  // The kept docs' ledger title + deep link, so a doc preview reads its human title.
  const docMeta = useMemo(
    () => new Map((corpus.data?.corpus.docs ?? []).map((d) => [d.ref, d] as const)),
    [corpus.data],
  );
  const labelOf = useCallback((ref: string): string => docMeta.get(ref)?.title ?? ref, [docMeta]);

  // Each open tab as a strip item: a doc labels by its ledger title (ref fallback),
  // a conflict by "a ↔ b" (both titles) , truncated in the strip, full on hover.
  const tabItems = useMemo<GuardTabStripItem[]>(
    () =>
      openTabs.map((t) => {
        const k = parseSpecKey(t.id);
        if (k.kind === 'overlap') {
          const label = `${labelOf(k.a)} ↔ ${labelOf(k.b)}`;
          return { ...t, label, title: label, icon: GitMerge };
        }
        const label = labelOf(k.ref);
        return { ...t, label, title: label, icon: FileText };
      }),
    [openTabs, labelOf],
  );

  return (
    <div className="flex h-full">
      <div className="w-[380px] shrink-0 overflow-auto border-r border-border">
        <SpecCorpusView repoId="ws" corpus={corpus} activeKey={activeId} onOpen={open} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <GuardTabStrip
          tabs={tabItems}
          activeId={activeId}
          onSelect={(t) => open(t.id, t.pinned)}
          onClose={close}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {sel?.kind === 'overlap' && corpus.data ? (
            <SpecOverlapDetail
              repoId="ws"
              area={sel.area}
              docA={sel.a}
              docB={sel.b}
              conflict={resolveConflictId(
                buildCorpusConflicts(corpus.data.corpus, {
                  manualExcludes: corpus.data.manualExcludes ?? [],
                  conflictResolutions: corpus.data.conflictResolutions ?? [],
                }),
                activeId ?? '',
              )}
              data={corpus.data}
              onResolved={(res) => {
                if (res) corpus.apply(res);
                else void corpus.refetch();
              }}
              onConflictChange={(list) => corpus.applyConflictResolutions(list)}
            />
          ) : sel?.kind === 'doc' ? (
            <SpecDocViewer
              repoId="ws"
              docRef={sel.ref}
              title={docMeta.get(sel.ref)?.title}
              url={docMeta.get(sel.ref)?.url}
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="Select a document or conflict"
              body="Choose a document to read it, or a conflict to resolve it."
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources , the provenance ledger (identity + deep link + last synced, never
// bodies), server-side paginated with search + source-kind filter.
// ---------------------------------------------------------------------------

interface KnowledgeDocRow {
  title: string;
  url: string | null;
  sourceKind: string;
  externalId: string;
  lastSyncedAt: string;
}

interface KnowledgeDocumentsResponse {
  documents: KnowledgeDocRow[];
  total: number;
}

const SOURCES_PAGE_SIZE = 50;

export function SourcesTab() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [rows, setRows] = useState<KnowledgeDocRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kinds seen so far , populates the filter without a dedicated endpoint.
  const [kinds, setKinds] = useState<string[]>([]);

  const load = useCallback(async (nextOffset: number, q: string, k: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('query', q);
      if (k) params.set('kind', k);
      params.set('limit', String(SOURCES_PAGE_SIZE));
      params.set('offset', String(nextOffset));
      const res = await getJson<KnowledgeDocumentsResponse>(`/api/ee/knowledge/documents?${params.toString()}`);
      setTotal(res.total);
      setRows((prev) => (nextOffset === 0 ? res.documents : [...prev, ...res.documents]));
      setOffset(nextOffset + res.documents.length);
      setKinds((prev) => [...new Set([...prev, ...res.documents.map((d) => d.sourceKind)])].sort());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  // Reload from page 0 on search / kind change (search lightly debounced).
  useEffect(() => {
    const q = query.trim();
    const t = setTimeout(() => void load(0, q, kind), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, kind, load]);

  const filtering = query.trim() !== '' || kind !== '';
  const hasMore = offset < total;

  // Before the first sync (no docs, no active filter): the connect CTA.
  if (loaded && !loading && total === 0 && !filtering) {
    return (
      <EmptyState
        icon={FileText}
        title="No sources yet"
        body="Connect a source and sync to see its documents here."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search sources"
          placeholder="Search sources"
          className="w-64 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center gap-x-4 [&>div]:border-0 [&>div]:px-0 [&>div]:py-0">
          <FilterBar
            label="Source"
            ariaLabel="Filter by source kind"
            options={kinds.map((k) => ({ key: k, label: k }))}
            selected={kind ? [kind] : []}
            onChange={(next) => setKind(next[0] ?? '')}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p className="px-6 py-3 text-[13px] text-destructive">{error}</p>}
        <table className="w-full border-collapse text-[13px]" aria-label="Knowledge sources">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Title</th>
              <th className="px-3 py-2 text-left font-semibold">Source</th>
              <th className="px-3 py-2 text-left font-semibold">Id</th>
              <th className="px-6 py-2 text-left font-semibold">Last synced</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={`${d.sourceKind}:${d.externalId}`} className="border-b border-border/60">
                <td className="px-6 py-2.5">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="text-foreground hover:underline">
                      {d.title}
                    </a>
                  ) : (
                    <span className="text-foreground">{d.title}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className={CHIP_CLASS}>{d.sourceKind}</span>
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-muted-foreground">{d.externalId}</td>
                <td className="px-6 py-2.5 text-muted-foreground">{formatRelativeTime(d.lastSyncedAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                  {loading ? 'Loading sources.' : 'No source matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {hasMore && (
          <div className="px-6 py-3">
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(offset, query.trim(), kind)}
              className="rounded border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
            >
              Load more ({total - offset} more)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
