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
 * Tabs:
 *   - Spec (default): areas → kept docs + conflicts; right pane = doc markdown /
 *     conflict resolution. Force-include / exclude + pick-a-side verdicts all hit
 *     the workspace decision endpoints.
 *   - Sources: the provenance ledger (server-paginated, searchable, kind-filtered).
 *   - Scenarios: the reused guard coverage view over the workspace scenario corpus.
 *     Generation is automatic — a conflict-free Process chains the scenario
 *     generate — so the tab only renders coverage, the blocked panel while a spec
 *     conflict is open, and a "Generating…" affordance while the job runs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Database, FileText, FlaskConical, Loader2, Search, X } from 'lucide-react';
import type {
  GuardGenerateReport,
  GuardRecipeCard as GuardRecipeCardData,
  GuardScenarioListItem,
  GuardScenarioSource,
} from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { SpecCorpusView, useSpecCorpus, parseSpecKey } from '@/components/spec/SpecCorpusView';
import { SpecOverlapDetail } from '@/components/spec/SpecOverlapDetail';
import { SpecDocViewer } from '@/components/spec/SpecDocViewer';
import { SpecSourceProvider } from '@/components/spec/spec-source';
import { GuardScenariosOverview } from '@/components/guard/GuardScenariosOverview';
import { GuardScenariosPanel } from '@/components/guard/GuardScenariosPanel';
import { GuardBlockedPanel, buildOpenConflictRows } from '@/components/guard/GuardBlockedPanel';
import { buildListRows, buildFindingRows, buildHeldRows } from '@/lib/guard-list-rows';
import type { GuardScenarioRowData } from '@/hooks/useGuardScenarios';
import type { SpecCorpusResponse } from '@/lib/api';
import { getJson, getJsonAllow404 } from './api';
import { createWorkspaceSpecSource } from './knowledge-spec-source';
import { useJobs } from './jobs/JobsContext';

type Tab = 'spec' | 'sources' | 'scenarios';

const TABS: Array<{ id: Tab; label: string; icon: typeof BookOpen }> = [
  { id: 'spec', label: 'Spec', icon: FileText },
  { id: 'scenarios', label: 'Scenarios', icon: FlaskConical },
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
        {tab === 'scenarios' && <ScenariosTab onGoToSpec={() => setTab('spec')} />}
        {tab === 'sources' && <SourcesTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spec — the reused corpus view + doc/conflict detail, over the workspace source.
// ---------------------------------------------------------------------------

function KnowledgeSpecTab() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const corpus = useSpecCorpus('ws', true);
  const open = useCallback((key: string) => setActiveKey(key), []);
  const sel = useMemo(() => (activeKey ? parseSpecKey(activeKey) : null), [activeKey]);
  // The kept docs' ledger title + deep link, so a doc preview reads its human title.
  const docMeta = useMemo(
    () => new Map((corpus.data?.corpus.docs ?? []).map((d) => [d.ref, d] as const)),
    [corpus.data],
  );

  return (
    <div className="flex h-full">
      <div className="w-[380px] shrink-0 overflow-auto border-r border-border">
        <SpecCorpusView repoId="ws" corpus={corpus} activeKey={activeKey} onOpen={open} />
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
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
            onClose={() => setActiveKey(null)}
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
  );
}

// ---------------------------------------------------------------------------
// Scenarios — the reused guard coverage view over the WORKSPACE scenario corpus.
// Generation is automatic: a conflict-free Process chains the org-scoped
// `knowledge.guard` job server-side (no button here). While a spec conflict is open
// the blocked panel shows instead — the same live-corpus derivation the repo
// GuardBlockedPanel uses; resolving the last conflict re-processes and re-chains.
// ---------------------------------------------------------------------------

const GUARD_TASK = 'knowledge.guard';

/** The workspace Scenarios-tab coverage payload (mirrors the repo guard reads). */
interface WorkspaceGuardCoverage {
  report: GuardGenerateReport | null;
  recipe: GuardRecipeCardData | null;
  scenarios: GuardScenarioListItem[];
  hasGenerated: boolean;
  hasScenarios: boolean;
}

function ScenariosTab({ onGoToSpec }: { onGoToSpec: () => void }) {
  const { activeJobs, onJobSettled } = useJobs();
  // Any active workspace guard job → "Generating…" (the jobs feed is org-scoped
  // server-side, so its mere presence is this workspace's run — survives refresh).
  const generating = activeJobs.some((j) => j.type === GUARD_TASK);

  const [corpus, setCorpus] = useState<SpecCorpusResponse | null | undefined>(undefined);
  const [coverage, setCoverage] = useState<WorkspaceGuardCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState<GuardScenarioSource | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, cov] = await Promise.all([
        getJsonAllow404<SpecCorpusResponse>('/api/ee/knowledge/spec/corpus'),
        getJson<WorkspaceGuardCoverage>('/api/ee/knowledge/guard/coverage'),
      ]);
      setCorpus(c);
      setCoverage(cov);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A settled guard job means scenarios just landed — refetch the coverage.
  useEffect(
    () =>
      onJobSettled((job) => {
        if (job.type === GUARD_TASK) void load();
      }),
    [onJobSettled, load],
  );

  // The LIVE open conflicts, derived from the workspace corpus (the same shared
  // derivation the repo blocked panel uses); blocks generation while any is open.
  const conflicts = useMemo(() => (corpus ? buildOpenConflictRows(corpus) : []), [corpus]);
  const blocked = conflicts.length > 0;

  // Workspace scenarios never run, so every row joins to a null last result.
  const scenarioRows = useMemo<GuardScenarioRowData[]>(
    () => (coverage?.scenarios ?? []).map((s) => ({ ...s, lastResult: null })),
    [coverage],
  );
  const listRows = useMemo(
    () =>
      buildListRows(
        scenarioRows,
        buildFindingRows(coverage?.report ?? null, scenarioRows),
        buildHeldRows(coverage?.report ?? null, scenarioRows),
      ),
    [scenarioRows, coverage],
  );

  const isEmpty = !!coverage && !coverage.hasGenerated && !coverage.hasScenarios;

  const openScenario = useCallback((id: string) => {
    setSelected(id);
    setSource(null);
    void getJson<GuardScenarioSource>(`/api/ee/knowledge/guard/scenario?id=${encodeURIComponent(id)}`)
      .then(setSource)
      .catch(() => setSource(null));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-3">
        <p className="text-xs text-muted-foreground">
          Scenarios test each spec section — generated automatically when Knowledge is processed.
        </p>
        {generating && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Generating…
          </span>
        )}
      </div>

      {error && (
        <div className="shrink-0 border-b border-border bg-red-500/10 px-6 py-2 text-xs text-red-500">{error}</div>
      )}

      <div className="min-h-0 flex-1">
        {loading && !coverage ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : blocked ? (
          <GuardBlockedPanel conflicts={conflicts} onOpenConflict={onGoToSpec} />
        ) : isEmpty ? (
          <EmptyState
            icon={FlaskConical}
            title="No scenarios yet"
            body="Scenarios are generated automatically when Knowledge is processed. Sync and process your sources to get started."
          />
        ) : (
          <div className="flex h-full">
            <div className="w-[340px] shrink-0 overflow-auto border-r border-border">
              <GuardScenariosPanel
                rows={listRows}
                loading={loading}
                error={error}
                activeId={selected}
                onOpen={(id) => openScenario(id)}
              />
            </div>
            <div className="min-w-0 flex-1 overflow-auto">
              {selected ? (
                <ScenarioSourceView
                  id={selected}
                  source={source}
                  onClose={() => {
                    setSelected(null);
                    setSource(null);
                  }}
                />
              ) : (
                <GuardScenariosOverview
                  recipe={coverage?.recipe ?? null}
                  report={coverage?.report ?? null}
                  scenarioRows={scenarioRows}
                  hasScenarios={!!coverage?.hasScenarios}
                  loading={loading}
                  error={error}
                  onOpenSpec={() => onGoToSpec()}
                  conflicts={conflicts}
                  onOpenConflict={() => onGoToSpec()}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One committed scenario's YAML source (the row preview), with a close affordance. */
function ScenarioSourceView({
  id,
  source,
  onClose,
}: {
  id: string;
  source: GuardScenarioSource | null;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="min-w-0 truncate font-mono text-xs text-foreground" title={id}>
          {source?.file ?? id}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {source ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground">
            {source.content}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
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
