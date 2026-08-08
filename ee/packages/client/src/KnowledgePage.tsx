/**
 * Workspace Knowledge — the enterprise console surface for the cross-repo spec
 * corpus derived from connected tools (Confluence / Jira / …) via Sync + Process.
 *
 * It reuses the REAL repo corpus components (`SpecCorpusView` /
 * `SpecOverlapDetail` / `SpecDocViewer`) unchanged, wrapping the Spec tab in a
 * `SpecSourceProvider` backed by a WORKSPACE data source (`/api/ee/knowledge/
 * spec/*`) instead of a repo one. The workspace source hides the on-demand Scan
 * (content arrives from connector syncs) and pages the "Not included" listing for
 * scale.
 *
 * The workspace level keeps ONLY specs + conflict resolution — repos generate their
 * guard scenarios from the union of workspace + repo specs, so there is no
 * workspace-level Scenarios tab.
 *
 * Tabs:
 *   - Spec (default): areas → kept docs + conflicts; the right pane opens each in
 *     the house preview/pin tab strip (single-click preview, double-click pin,
 *     `?spec=`-synced) — a doc opens the markdown viewer, a conflict the resolution
 *     detail. Force-include / exclude + pick-a-side verdicts all hit the workspace
 *     decision endpoints.
 *   - Sources: the provenance ledger (server-paginated, searchable, kind-filtered).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Database, FileText, GitMerge, Loader2, Search } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { SpecCorpusView, useSpecCorpus, parseSpecKey } from '@/components/spec/SpecCorpusView';
import { SpecOverlapDetail } from '@/components/spec/SpecOverlapDetail';
import { SpecDocViewer } from '@/components/spec/SpecDocViewer';
import { SpecSourceProvider } from '@/components/spec/spec-source';
import { GuardTabStrip, type GuardTabStripItem } from '@/components/guard/GuardTabStrip';
import { useGuardTabs } from '@/hooks/useGuardTabs';
import { getJson } from './api';
import { createWorkspaceSpecSource } from './knowledge-spec-source';

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
            Workspace spec corpus, shared by every repo — curated from your connected sources.
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
// Spec — the reused corpus view + doc/conflict detail, over the workspace source.
// ---------------------------------------------------------------------------

function KnowledgeSpecTab() {
  const corpus = useSpecCorpus('ws', true);
  // The shared preview/pin tab model (single-click preview, double-click pin),
  // `?spec=`-synced — the same reducer + strip the repo Spec views use.
  const { activeId, openTabs, open, close } = useGuardTabs('spec', 'ws');
  const sel = useMemo(() => (activeId ? parseSpecKey(activeId) : null), [activeId]);
  // The kept docs' ledger title + deep link, so a doc preview reads its human title.
  const docMeta = useMemo(
    () => new Map((corpus.data?.corpus.docs ?? []).map((d) => [d.ref, d] as const)),
    [corpus.data],
  );
  const labelOf = useCallback((ref: string): string => docMeta.get(ref)?.title ?? ref, [docMeta]);

  // Each open tab as a strip item: a doc labels by its ledger title (ref fallback),
  // a conflict by "a ↔ b" (both titles) — truncated in the strip, full on hover.
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
// Sources — the provenance ledger (identity + deep link + last synced, never
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

function SourcesTab() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [rows, setRows] = useState<KnowledgeDocRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kinds seen so far — populates the filter without a dedicated endpoint.
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
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-6 py-3">
        <div className="flex flex-1 items-center gap-1.5 rounded border border-border px-2 py-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none"
        >
          <option value="">All sources</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : total === 0 && loaded && !loading ? (
          <p className="text-sm text-muted-foreground">No documents match your filter.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4 font-medium">Title</th>
                <th className="pb-2 pr-4 font-medium">Source</th>
                <th className="pb-2 pr-4 font-medium">Last synced</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={`${d.sourceKind}:${d.externalId}`} className="border-t border-border">
                  <td className="py-2 pr-4">
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {d.title}
                      </a>
                    ) : (
                      d.title
                    )}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{d.sourceKind}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{new Date(d.lastSyncedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {hasMore && !loading && (
          <button
            type="button"
            onClick={() => void load(offset, query.trim(), kind)}
            className="mt-3 rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted/40"
          >
            Load more ({total - offset} more)
          </button>
        )}
      </div>
    </div>
  );
}
