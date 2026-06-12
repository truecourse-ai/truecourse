/**
 * Workspace Knowledge — the enterprise console surface for specs/contracts
 * derived from connected tools (or, in Phase 1, manually uploaded docs) and
 * shared by every repo in the workspace.
 *
 * It reuses the REAL repo Spec panels (`SpecPanel` / `SpecConflictDetail` /
 * `SpecCanonicalFile` / `DecisionsPanel` / `ContractsPanel`) — identical
 * components — by wrapping them in a `SpecProvider` backed by a WORKSPACE data
 * source (`/api/ee/knowledge/*`) instead of a repo one. The only differences are
 * the capability-based exceptions you'd expect: the on-demand "Scan" button is
 * hidden (content comes from connector syncs), plus a Knowledge-only Sources tab.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, FileText, GitBranch, Loader2 } from 'lucide-react';
import { SpecProvider, useSpec } from '@/components/spec/SpecContext';
import { SpecHeaderActions } from '@/components/spec/SpecHeaderActions';
import { SpecPanel } from '@/components/spec/SpecPanel';
import { SpecConflictDetail } from '@/components/spec/SpecConflictDetail';
import { SpecCanonicalFile } from '@/components/spec/SpecCanonicalFile';
import { DecisionsPanel } from '@/components/drift/DecisionsPanel';
import { ContractsPanel } from '@/components/drift/ContractsPanel';
import { CodeViewer } from '@/components/code/CodeViewer';
import { FileBreadcrumb } from '@/components/code/FileBreadcrumb';
import { useCanonicalSpecTree } from '@/hooks/useCanonicalSpecTree';
import type { ContractsTree } from '@/lib/api';
import {
  createWorkspaceSpecDataSource,
  getWorkspaceContractsTree,
  getWorkspaceContractsFile,
  listKnowledgeDocuments,
  type KnowledgeDocRow,
} from './knowledge-source';

type Tab = 'spec' | 'decisions' | 'contracts' | 'sources';

const TABS: Array<{ id: Tab; label: string; icon: typeof BookOpen }> = [
  { id: 'spec', label: 'Spec', icon: FileText },
  { id: 'decisions', label: 'Decisions', icon: GitBranch },
  { id: 'contracts', label: 'Contracts', icon: BookOpen },
  { id: 'sources', label: 'Sources', icon: FileText },
];

export default function KnowledgePage() {
  const source = useMemo(() => createWorkspaceSpecDataSource(), []);
  return (
    <SpecProvider source={source}>
      <KnowledgeBody source={source} />
    </SpecProvider>
  );
}

function KnowledgeBody({ source }: { source: ReturnType<typeof createWorkspaceSpecDataSource> }) {
  const [tab, setTab] = useState<Tab>('spec');
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);
  const [activeCanonicalPath, setActiveCanonicalPath] = useState<string | null>(null);

  const {
    tree: canonicalTree,
    isLoading: canonicalLoading,
    error: canonicalError,
    refetch: refetchCanonical,
  } = useCanonicalSpecTree(source);
  const { canonicalVersion } = useSpec();

  // The canonical tree is derived from claims.json; re-fetch whenever the scan
  // completes or a decision re-merges (the provider bumps canonicalVersion).
  useEffect(() => {
    refetchCanonical();
  }, [canonicalVersion, refetchCanonical]);

  const selectConflict = useCallback((id: string | null) => {
    setActiveConflictId(id);
    setActiveCanonicalPath(null);
  }, []);
  const openCanonical = useCallback((filePath: string) => {
    setActiveCanonicalPath(filePath);
    setActiveConflictId(null);
  }, []);

  const showCanonical = activeCanonicalPath !== null && tab === 'spec';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <BookOpen className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Knowledge</h1>
          <p className="text-xs text-muted-foreground">
            Workspace specs &amp; contracts, shared by every repo.
          </p>
        </div>
        {/* supportsRescan is false for workspace → only "Accept all defaults"
            shows; the on-demand Scan button is hidden (re-upload to re-process). */}
        <SpecHeaderActions />
      </header>

      <nav className="flex gap-1 border-b px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
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
          <div className="flex h-full">
            <div className="w-[380px] shrink-0 overflow-auto border-r">
              <SpecPanel
                canonicalTree={canonicalTree}
                canonicalLoading={canonicalLoading}
                canonicalError={canonicalError}
                activeConflictId={activeConflictId}
                onSelectConflict={selectConflict}
                activeCanonicalPath={activeCanonicalPath}
                onOpenCanonicalFile={(filePath) => openCanonical(filePath)}
              />
            </div>
            <div className="min-w-0 flex-1 overflow-auto">
              {showCanonical && activeCanonicalPath ? (
                <SpecCanonicalFile filePath={activeCanonicalPath} />
              ) : activeConflictId ? (
                <SpecConflictDetail
                  conflictId={activeConflictId}
                  onClose={() => setActiveConflictId(null)}
                />
              ) : (
                <DetailPlaceholder text="Select a conflict or a spec section." />
              )}
            </div>
          </div>
        )}

        {tab === 'decisions' && (
          <div className="flex h-full">
            <div className="w-[380px] shrink-0 overflow-auto border-r">
              <DecisionsPanel
                activeConflictId={activeConflictId}
                onSelectConflict={setActiveConflictId}
              />
            </div>
            <div className="min-w-0 flex-1 overflow-auto">
              {activeConflictId ? (
                <SpecConflictDetail
                  conflictId={activeConflictId}
                  onClose={() => setActiveConflictId(null)}
                />
              ) : (
                <DetailPlaceholder text="Select a decided conflict to review or change it." />
              )}
            </div>
          </div>
        )}

        {tab === 'contracts' && <KnowledgeContracts />}

        {tab === 'sources' && <SourcesTab />}
      </div>
    </div>
  );
}

function DetailPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contracts — the workspace `.tc` corpus generated on sync. Reuses the repo
// ContractsPanel (left) + CodeViewer (right), pointed at `/api/ee/knowledge/
// contracts/*`. Mounts fresh each time the tab opens, so a recent sync shows.
// ---------------------------------------------------------------------------

function KnowledgeContracts() {
  const [tree, setTree] = useState<ContractsTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getWorkspaceContractsTree()
      .then((t) => {
        if (!cancelled) setTree(t);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full">
      <div className="w-[380px] shrink-0 overflow-auto border-r">
        <ContractsPanel
          tree={tree}
          isLoading={loading}
          error={error}
          activePath={activePath}
          onOpen={(path) => setActivePath(path)}
          hosted
        />
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        {activePath ? (
          <WorkspaceContractFile filePath={activePath} />
        ) : (
          <DetailPlaceholder text="Select a contract to view." />
        )}
      </div>
    </div>
  );
}

function WorkspaceContractFile({ filePath }: { filePath: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    getWorkspaceContractsFile(filePath)
      .then((f) => {
        if (!cancelled) setContent(f.content);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  return (
    <div className="flex h-full flex-col">
      <FileBreadcrumb filePath={filePath} />
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <CodeViewer content={content ?? ''} language="tc" filePath={filePath} violations={[]} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources — the provenance ledger (identity + hash only, never bodies)
// ---------------------------------------------------------------------------

function SourcesTab() {
  const [docs, setDocs] = useState<KnowledgeDocRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listKnowledgeDocuments()
      .then(setDocs)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <DetailPlaceholder text={error} />;
  if (!docs) return <DetailPlaceholder text="Loading sources…" />;
  if (docs.length === 0) {
    return (
      <DetailPlaceholder text="No source docs yet — connect a knowledge source in Settings → Integrations." />
    );
  }

  return (
    <div className="overflow-auto p-6">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="pb-2 pr-4 font-medium">Title</th>
            <th className="pb-2 pr-4 font-medium">Source</th>
            <th className="pb-2 pr-4 font-medium">Last synced</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={`${d.sourceKind}:${d.externalId}`} className="border-t">
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
              <td className="py-2 pr-4 text-muted-foreground">
                {new Date(d.lastSyncedAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
