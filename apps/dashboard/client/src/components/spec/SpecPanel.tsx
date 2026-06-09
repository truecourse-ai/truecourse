/**
 * SpecPanel — the sidebar for the Spec tab.
 *
 * Layout:
 *   Header              counts (docs, claims, resolved, open)
 *   Skipped docs (opt)  collapsible LLM-skipped doc list
 *   Open conflicts      click to resolve in the right pane
 *   Canonical spec      always visible — drill into (module, topic)
 *
 * Both sections render at once now (no mode switch): the user can
 * resolve conflicts in the top half and browse the canonical claim
 * set in the bottom half without leaving the tab.
 */

import { Loader2, AlertCircle, GitBranch, Play } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { useSpec } from './SpecContext';
import { SpecCanonicalPanel } from './SpecCanonicalPanel';
import { SpecStats } from './SpecStats';
import { SpecSkippedDocs } from './SpecSkippedDocs';
import type { CanonicalSpecTree, SpecConflict, SpecScanResponse } from '@/lib/api';

export interface SpecPanelProps {
  /** Canonical tree owned by `useCanonicalSpecTree` at page level. */
  canonicalTree: CanonicalSpecTree | null;
  canonicalLoading: boolean;
  canonicalError: string | null;
  activeConflictId: string | null;
  onSelectConflict: (id: string | null) => void;
  activeCanonicalPath: string | null;
  /** Single-click (transient) / double-click (pinned). Opens a tab. */
  onOpenCanonicalFile: (filePath: string, pinned: boolean) => void;
}

export function SpecPanel({
  canonicalTree,
  canonicalLoading,
  canonicalError,
  activeConflictId,
  onSelectConflict,
  activeCanonicalPath,
  onOpenCanonicalFile,
}: SpecPanelProps) {
  const { scan, hydrating, error, supportsRescan } = useSpec();

  return (
    <div className="flex h-full flex-col">
      <SpecStats />
      <SpecSkippedDocs />
      {error && (
        <div className="border-b border-border px-4 py-2">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {hydrating ? (
          <CenteredSpinner />
        ) : !scan ? (
          <NoScanYet supportsRescan={supportsRescan} />
        ) : (
          <>
            <div
              className={`border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wider ${
                scan.openConflicts.length === 0
                  ? 'bg-card/80 text-muted-foreground'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
              }`}
            >
              Open conflicts · {scan.openConflicts.length}
            </div>
            <ConflictsSection
              scan={scan}
              activeConflictId={activeConflictId}
              onSelectConflict={onSelectConflict}
            />
            <div className="border-t border-border">
              <div className="border-b border-border bg-card/80 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Canonical spec · {canonicalTree?.modules.length ?? 0}
              </div>
              <SpecCanonicalPanel
                tree={canonicalTree}
                isLoading={canonicalLoading}
                error={canonicalError}
                activePath={activeCanonicalPath}
                onOpen={onOpenCanonicalFile}
                supportsRescan={supportsRescan}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Open-conflicts section
// ---------------------------------------------------------------------------

function ConflictsSection({
  scan,
  activeConflictId,
  onSelectConflict,
}: {
  scan: SpecScanResponse;
  activeConflictId: string | null;
  onSelectConflict: (id: string | null) => void;
}) {
  if (scan.openConflicts.length === 0) {
    return (
      <div className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
        No open conflicts — every claim is resolved or auto-merged.
      </div>
    );
  }
  return (
    <ConflictList scan={scan} activeConflictId={activeConflictId} onSelect={onSelectConflict} />
  );
}

/**
 * Topic display order. Follows the natural reading flow for someone
 * exploring a spec:
 *   1. overview   — what is this?
 *   2. auth       — how is access controlled?
 *   3. endpoints  — the API surface
 *   4. data       — what entities flow through?
 *   5. effects    — what happens after a request?
 *   6. errors     — what can go wrong?
 * Unknown topics (shouldn't appear, but defensive) fall through to
 * the end alphabetically.
 */
const TOPIC_ORDER: readonly string[] = [
  'overview',
  'auth',
  'endpoints',
  'data',
  'effects',
  'errors',
];

function compareTopics(a: string, b: string): number {
  const ai = TOPIC_ORDER.indexOf(a);
  const bi = TOPIC_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

function ConflictList({
  scan,
  activeConflictId,
  onSelect,
}: {
  scan: SpecScanResponse;
  activeConflictId: string | null;
  onSelect: (id: string | null) => void;
}) {
  // Separate chain conflicts from content conflicts so the user
  // resolves the cascading ones first.
  const chainConflicts: SpecConflict[] = [];
  const byTopic = new Map<string, SpecConflict[]>();
  for (const c of scan.openConflicts) {
    const isChain = c.candidates[0]?.claim.id.startsWith('version-chain:');
    if (isChain) {
      chainConflicts.push(c);
      continue;
    }
    const list = byTopic.get(c.topic) ?? [];
    list.push(c);
    byTopic.set(c.topic, list);
  }
  // Topic ordering: natural reading flow (TOPIC_ORDER); subjects
  // within each topic alphabetically.
  const topicOrder = [...byTopic.keys()].sort(compareTopics);
  for (const t of topicOrder) {
    byTopic.set(
      t,
      (byTopic.get(t) ?? []).sort((a, b) => a.subject.localeCompare(b.subject)),
    );
  }

  return (
    <div>
      {chainConflicts.length > 0 && (
        <Section title="Resolve first" count={chainConflicts.length} tone="amber">
          {chainConflicts.map((c) => (
            <ConflictRow
              key={c.id}
              conflict={c}
              active={c.id === activeConflictId}
              onSelect={() => onSelect(c.id)}
              isVersionChain
            />
          ))}
        </Section>
      )}
      {topicOrder.map((topic) => (
        <Section
          key={topic}
          title={topic}
          count={(byTopic.get(topic) ?? []).length}
        >
          {(byTopic.get(topic) ?? []).map((c) => (
            <ConflictRow
              key={c.id}
              conflict={c}
              active={c.id === activeConflictId}
              onSelect={() => onSelect(c.id)}
            />
          ))}
        </Section>
      ))}
    </div>
  );
}

function Section({
  title,
  count,
  tone,
  dimmed,
  children,
}: {
  title: string;
  count: number;
  tone?: 'amber';
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={dimmed ? 'opacity-50' : undefined}>
      <div
        className={`sticky top-0 z-10 flex items-center justify-between border-b border-border px-4 py-1.5 text-[10px] uppercase tracking-wider ${
          tone === 'amber' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-card/80 text-muted-foreground'
        }`}
      >
        <span>{title}</span>
        <span>{count}</span>
      </div>
      {children}
    </div>
  );
}

function ConflictRow({
  conflict,
  active,
  onSelect,
  isVersionChain,
  disabled,
  disabledReason,
}: {
  conflict: SpecConflict;
  active: boolean;
  onSelect: () => void;
  isVersionChain?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const label = isVersionChain
    ? conflict.subject.replace(/^version chain:\s*/, '')
    : conflict.subject;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={`flex w-full items-center gap-2 border-b border-border/60 px-4 py-2 text-left text-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed text-muted-foreground'
          : active
            ? 'bg-primary/10 text-foreground'
            : 'hover:bg-muted/40'
      }`}
    >
      {isVersionChain ? (
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-amber-400" />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {conflict.candidates.length}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

function CenteredSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function NoScanYet({ supportsRescan }: { supportsRescan: boolean }) {
  return (
    <EmptyState
      icon={Play}
      title="No scan yet"
      body={
        supportsRescan ? (
          <>
            Click <strong>Scan</strong> in the header to discover docs, extract
            claims, and surface conflicts.
          </>
        ) : (
          <>
            The spec is generated automatically when this repository is scanned.
            Claims and conflicts will appear here once a scan completes.
          </>
        )
      }
    />
  );
}
