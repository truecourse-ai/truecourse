/**
 * SpecPanel — the sidebar list of conflicts for the Spec tab. The
 * conflict detail (candidates, pick/custom UI) lives in
 * SpecConflictDetail, rendered in the main content slot by
 * RepoGraphPage. State is shared via SpecProvider.
 *
 * Layout:
 *   Header      counts (docs, claims, resolved, open) + Apply
 *   Toolbar     filter + accept-all-defaults + refresh + "Scanned ago"
 *   List        flat selectable rows, grouped by topic; chain
 *               conflicts pulled into a "Resolve first" section
 */

import { useEffect } from 'react';
import { Loader2, AlertCircle, Play, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSpec } from './SpecContext';
import { SpecCanonicalPanel } from './SpecCanonicalPanel';
import type { CanonicalSpecTree, SpecConflict, SpecScanResponse } from '@/lib/api';

/**
 * View mode for the Spec tab — driven entirely by scan state. The
 * sidebar shows the conflict list while there's anything open, and
 * flips to the canonical browser once everything is resolved. No
 * manual toggle: conflict resolution comes first, browsing later.
 */
export type SpecView = 'conflicts' | 'canonical';

export function deriveSpecView(scan: SpecScanResponse | null): SpecView {
  return scan && scan.openConflicts.length === 0 ? 'canonical' : 'conflicts';
}

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
  /** Used to clear the canonical selection when the view flips. */
  onSelectCanonicalFile: (filePath: string | null) => void;
}

export function SpecPanel({
  canonicalTree,
  canonicalLoading,
  canonicalError,
  activeConflictId,
  onSelectConflict,
  activeCanonicalPath,
  onOpenCanonicalFile,
  onSelectCanonicalFile,
}: SpecPanelProps) {
  const { scan, hydrating, loading, error, refresh } = useSpec();
  const view = deriveSpecView(scan);

  // When the view flips (because a scan resolved or surfaced
  // conflicts), drop the other view's selection so the right pane
  // never tries to render something the sidebar is no longer showing.
  useEffect(() => {
    if (view === 'canonical') {
      if (activeConflictId !== null) onSelectConflict(null);
    } else {
      if (activeCanonicalPath !== null) onSelectCanonicalFile(null);
    }
  }, [view, activeConflictId, activeCanonicalPath, onSelectConflict, onSelectCanonicalFile]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
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
        ) : !scan && !loading ? (
          <NoScanYet onScan={refresh} />
        ) : loading && !scan ? (
          <ScanningPlaceholder />
        ) : view === 'canonical' ? (
          <SpecCanonicalPanel
            tree={canonicalTree}
            isLoading={canonicalLoading}
            error={canonicalError}
            activePath={activeCanonicalPath}
            onOpen={onOpenCanonicalFile}
          />
        ) : (
          <ConflictList
            scan={scan!}
            activeConflictId={activeConflictId}
            onSelect={onSelectConflict}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict list — grouped, selectable rows
// ---------------------------------------------------------------------------

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
          tone === 'amber' ? 'bg-amber-500/10 text-amber-300' : 'bg-card/80 text-muted-foreground'
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

function NoScanYet({ onScan }: { onScan: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Play className="h-8 w-8 text-muted-foreground" />
      <div>
        <h3 className="text-sm font-semibold">No scan yet</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Run a scan to discover docs, extract claims, and surface conflicts.
        </p>
      </div>
      <Button onClick={onScan} size="sm">
        <Play className="mr-2 h-4 w-4" />
        Run scan
      </Button>
    </div>
  );
}

function ScanningPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span>Scanning docs…</span>
    </div>
  );
}


