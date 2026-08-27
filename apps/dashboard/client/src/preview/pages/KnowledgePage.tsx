/**
 * Knowledge: the workspace-level spec corpus, the enterprise page's two tabs
 * (Spec, Sources) with the Spec tab in the two-level shape every list has: a
 * flat table of the workspace documents and conflicts, and a document or
 * conflict opened as its own page (`/knowledge/doc/:ref`,
 * `/knowledge/conflict/:id`). Sources is the enterprise provenance ledger,
 * vendored as is. An enterprise entitlement; the connectors that fill it live
 * under Settings › Integrations.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, FileText } from 'lucide-react';
import { buildCorpusConflicts, resolveConflictId } from '@/preview/vendor/shared';
import { SpecSourceProvider } from '@/components/spec/spec-source';
import { EmptyState } from '@/components/ui/empty-state';
import { CHIP_CLASS, PageHeader, SideMenu } from '@/preview/ui/bits';
import { FilterBar } from '@/preview/ui/filter-bar';
import { StatusWord } from '@/preview/ui/status-word';
import { parseSpecKey, useSpecCorpus } from '@/preview/vendor/components/spec/SpecCorpusView';
import { SpecDocViewer } from '@/preview/vendor/components/spec/SpecDocViewer';
import { SpecOverlapDetail } from '@/preview/vendor/components/spec/SpecOverlapDetail';
import { SourcesTab } from '@/preview/vendor/ee/KnowledgePage';
import { formatRelativeTime } from '@/preview/vendor/shared/format/relative-time';
import { createWorkspaceSpecSource } from '@/preview/data/fake-api';
import { KNOWLEDGE_DOCS } from '@/preview/data/knowledge';

const WS = 'ws';
const BASE = '/preview/knowledge';

type Row =
  | { kind: 'doc'; id: string; ref: string; title: string; area: string; source: string; synced: string }
  | { kind: 'conflict'; id: string; title: string; area: string; resolved: boolean };

function SpecTable() {
  const navigate = useNavigate();
  const corpus = useSpecCorpus(WS, true);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [areaFilter, setAreaFilter] = useState<string[]>([]);

  const rows = useMemo<Row[]>(() => {
    const data = corpus.data;
    if (!data) return [];
    const areaOf = (tag: string) => tag.split('/').pop() ?? tag;
    const docs: Row[] = data.corpus.docs.map((d) => ({
      kind: 'doc',
      id: d.ref,
      ref: d.ref,
      title: d.title ?? d.ref,
      area: areaOf(d.areaTags[0] ?? ''),
      source: KNOWLEDGE_DOCS.find((k) => k.ref === d.ref)?.sourceKind ?? 'connector',
      synced: formatRelativeTime(d.lastTouched),
    }));
    const conflicts: Row[] = buildCorpusConflicts(data.corpus, {
      manualExcludes: data.manualExcludes ?? [],
      conflictResolutions: data.conflictResolutions ?? [],
    }).map((cf) => ({ kind: 'conflict', id: cf.id, title: cf.note || `${cf.a} and ${cf.b}`, area: areaOf(cf.area), resolved: cf.resolved }));
    return [...conflicts, ...docs];
  }, [corpus.data]);

  const typeOptions = useMemo(
    () =>
      [
        { key: 'doc', label: 'Documents', count: rows.filter((r) => r.kind === 'doc').length },
        { key: 'conflict', label: 'Conflicts', count: rows.filter((r) => r.kind === 'conflict').length },
      ].filter((o) => o.count > 0),
    [rows],
  );
  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.kind === 'doc') counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, label: key, count }));
  }, [rows]);
  const areaOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, label: key, count }));
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!q || r.title.toLowerCase().includes(q) || (r.kind === 'doc' && r.ref.toLowerCase().includes(q))) &&
        (typeFilter.length === 0 || typeFilter.includes(r.kind)) &&
        (sourceFilter.length === 0 || (r.kind === 'doc' && sourceFilter.includes(r.source))) &&
        (areaFilter.length === 0 || areaFilter.includes(r.area)),
    );
  }, [rows, query, typeFilter, sourceFilter, areaFilter]);

  const openRow = (r: Row) =>
    navigate(r.kind === 'doc' ? `${BASE}/doc/${encodeURIComponent(r.ref)}` : `${BASE}/conflict/${encodeURIComponent(r.id)}`);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search knowledge"
          placeholder="Search documents and conflicts"
          className="w-64 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center gap-x-4 [&>div]:border-0 [&>div]:px-0 [&>div]:py-0">
          <FilterBar label="Type" ariaLabel="Filter by type" options={typeOptions} selected={typeFilter} onChange={setTypeFilter} />
          <FilterBar label="Source" ariaLabel="Filter by source" options={sourceOptions} selected={sourceFilter} onChange={setSourceFilter} multi />
          <FilterBar label="Area" ariaLabel="Filter by area" options={areaOptions} selected={areaFilter} onChange={setAreaFilter} multi />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]" aria-label="Workspace knowledge">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Document</th>
              <th className="px-3 py-2 text-left font-semibold">Source</th>
              <th className="px-3 py-2 text-left font-semibold">Area</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-6 py-2 text-left font-semibold">Synced</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                tabIndex={0}
                onClick={() => openRow(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openRow(r);
                }}
                className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
              >
                <td className="px-6 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-foreground">{r.title}</span>
                    {r.kind === 'conflict' && <span className={CHIP_CLASS}>conflict</span>}
                  </span>
                  {r.kind === 'doc' && <span className="block truncate font-mono text-[11px] text-muted-foreground">{r.ref}</span>}
                </td>
                <td className="px-3 py-2.5">{r.kind === 'doc' && <span className={CHIP_CLASS}>{r.source}</span>}</td>
                <td className="px-3 py-2.5">
                  <span className={CHIP_CLASS}>{r.area}</span>
                </td>
                <td className="px-3 py-2.5">
                  {r.kind === 'conflict' && (
                    <StatusWord tone={r.resolved ? 'success' : 'blocked'} word={r.resolved ? 'Resolved' : 'Open'} />
                  )}
                </td>
                <td className="px-6 py-2.5 text-muted-foreground">{r.kind === 'doc' ? r.synced : ''}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                  {corpus.hydrating ? 'Loading the workspace corpus.' : 'Nothing matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemPage({ kind, itemId }: { kind: 'doc' | 'conflict'; itemId: string }) {
  const corpus = useSpecCorpus(WS, true);
  const meta = corpus.data?.corpus.docs.find((d) => d.ref === itemId);
  const sel = kind === 'conflict' ? parseSpecKey(itemId) : null;
  const titleOf = (ref: string) => corpus.data?.corpus.docs.find((d) => d.ref === ref)?.title ?? ref;
  const title =
    kind === 'doc' ? meta?.title ?? itemId : sel?.kind === 'overlap' ? `${titleOf(sel.a)} and ${titleOf(sel.b)}` : itemId;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link to={BASE} className="shrink-0 font-semibold text-foreground hover:underline">
            Spec
          </Link>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <h1 className="min-w-0 truncate font-semibold text-foreground">{title}</h1>
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {kind === 'conflict' && sel?.kind === 'overlap' && corpus.data ? (
          <SpecOverlapDetail
            repoId={WS}
            area={sel.area}
            docA={sel.a}
            docB={sel.b}
            conflict={resolveConflictId(
              buildCorpusConflicts(corpus.data.corpus, {
                manualExcludes: corpus.data.manualExcludes ?? [],
                conflictResolutions: corpus.data.conflictResolutions ?? [],
              }),
              itemId,
            )}
            data={corpus.data}
            onResolved={(res) => {
              if (res) corpus.apply(res);
              else void corpus.refetch();
            }}
            onConflictChange={(list) => corpus.applyConflictResolutions(list)}
          />
        ) : kind === 'doc' ? (
          <SpecDocViewer repoId={WS} docRef={itemId} title={meta?.title} url={meta?.url} />
        ) : (
          <EmptyState icon={FileText} title="No such item" body="Nothing is recorded under that id." />
        )}
      </div>
    </div>
  );
}

export default function KnowledgePage({
  tab = 'spec',
  kind,
  itemId,
}: {
  tab?: 'spec' | 'sources';
  kind?: 'doc' | 'conflict';
  itemId?: string;
}) {
  const source = useMemo(() => createWorkspaceSpecSource(), []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Knowledge" />
      <div className="flex min-h-0 flex-1">
        <SideMenu
          label="Knowledge sections"
          activeId={tab}
          items={[
            { id: 'spec', label: 'Spec', to: BASE },
            { id: 'sources', label: 'Sources', to: `${BASE}/sources` },
          ]}
        />
        <div className="min-h-0 min-w-0 flex-1">
          {kind && itemId ? (
            <SpecSourceProvider source={source}>
              <ItemPage kind={kind} itemId={itemId} />
            </SpecSourceProvider>
          ) : tab === 'spec' ? (
            <SpecSourceProvider source={source}>
              <SpecTable />
            </SpecSourceProvider>
          ) : (
            <SourcesTab />
          )}
        </div>
      </div>
    </div>
  );
}
