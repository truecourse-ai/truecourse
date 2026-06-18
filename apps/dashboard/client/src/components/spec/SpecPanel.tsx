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

import { useState } from 'react';
import { Loader2, AlertCircle, GitBranch, Play, Folder, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { useSpec } from './SpecContext';
import { SpecCanonicalPanel } from './SpecCanonicalPanel';
import { SpecStats } from './SpecStats';
import { SpecSkippedDocs } from './SpecSkippedDocs';
import type { CanonicalSpecTree, SpecConflict, SpecScanResponse, SpecDiff } from '@/lib/api';

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
  /** PR view: claims the PR adds/removes + the new conflicts it introduces. */
  prDiff?: SpecDiff | null;
  /** PR / Git-Diff mode: show ONLY the delta (added/removed + new conflicts). */
  diffMode?: boolean;
}

export function SpecPanel({
  canonicalTree,
  canonicalLoading,
  canonicalError,
  activeConflictId,
  onSelectConflict,
  activeCanonicalPath,
  onOpenCanonicalFile,
  prDiff,
  diffMode = false,
}: SpecPanelProps) {
  const { scan, hydrating, error, supportsRescan } = useSpec();

  // Diff mode (PR / Git Diff) swaps the whole view for just the delta, like Verify.
  // Diff mode (PR / Git Diff): same Spec UX — the stats strip shows the delta
  // counts, and the changed claims render in the canonical folder/icon tree.
  if (diffMode) {
    return (
      <div className="flex h-full flex-col">
        <SpecStats
          diff={{
            added: prDiff?.added.length ?? 0,
            removed: prDiff?.removed.length ?? 0,
            conflicts: prDiff?.newConflictCount ?? 0,
          }}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <SpecDiffOnly diff={prDiff ?? null} onOpen={onOpenCanonicalFile} activePath={activeCanonicalPath} />
        </div>
      </div>
    );
  }

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

/**
 * PR / Git-Diff: the spec delta, rendered in the SAME canonical folder/icon tree
 * (module folders → changed claims) as the normal Spec view — added normally,
 * removed struck-through. Clicking a claim opens its `module/topic` section.
 */
function SpecDiffOnly({
  diff,
  onOpen,
  activePath,
}: {
  diff: SpecDiff | null;
  onOpen: (path: string, pinned: boolean) => void;
  activePath: string | null;
}) {
  if (!diff) return <CenteredSpinner />;
  if (diff.added.length === 0 && diff.removed.length === 0 && diff.newConflictCount === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="No spec changes"
        body="This PR doesn't add, remove, or change any spec claims."
      />
    );
  }
  const byModule = new Map<string, { added: SpecDiff['added']; removed: SpecDiff['removed'] }>();
  const bucket = (m: string) => {
    let b = byModule.get(m);
    if (!b) {
      b = { added: [], removed: [] };
      byModule.set(m, b);
    }
    return b;
  };
  for (const c of diff.added) bucket(c.module).added.push(c);
  for (const c of diff.removed) bucket(c.module).removed.push(c);
  const modules = [...byModule.keys()].sort();
  return (
    <div>
      {diff.newConflictCount > 0 && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          {diff.newConflictCount} new conflict{diff.newConflictCount === 1 ? '' : 's'} introduced by this PR — resolve them to unblock the gate.
        </div>
      )}
      <div className="flex flex-col gap-1 py-1">
        {modules.map((m) => (
          <SpecDiffModule key={m} name={m} claims={byModule.get(m)!} onOpen={onOpen} activePath={activePath} />
        ))}
      </div>
    </div>
  );
}

/** One module folder in the spec diff — mirrors the canonical tree's ModuleGroup. */
function SpecDiffModule({
  name,
  claims,
  onOpen,
  activePath,
}: {
  name: string;
  claims: { added: SpecDiff['added']; removed: SpecDiff['removed'] };
  onOpen: (path: string, pinned: boolean) => void;
  activePath: string | null;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-border bg-card px-3 py-1.5 text-left text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">{name}</span>
        <span className="shrink-0 text-[11px]">{claims.added.length + claims.removed.length}</span>
      </button>
      {open && (
        <div>
          {claims.added.map((c) => (
            <SpecDiffClaim key={`a-${c.id}`} c={c} removed={false} onOpen={onOpen} activePath={activePath} />
          ))}
          {claims.removed.map((c) => (
            <SpecDiffClaim key={`r-${c.id}`} c={c} removed onOpen={onOpen} activePath={activePath} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One changed claim — mirrors the canonical tree's topic row (FileText icon). */
function SpecDiffClaim({
  c,
  removed,
  onOpen,
  activePath,
}: {
  c: SpecDiff['added'][number];
  removed: boolean;
  onOpen: (path: string, pinned: boolean) => void;
  activePath: string | null;
}) {
  const path = `${c.module}/${c.topic}`;
  const isActive = path === activePath;
  return (
    <button
      type="button"
      onClick={() => onOpen(path, false)}
      onDoubleClick={() => onOpen(path, true)}
      title={`${c.module} / ${c.topic} · ${c.subject} — click to view, double-click to pin`}
      className={`flex w-full items-center gap-1.5 px-3 py-1.5 pl-9 text-left text-[13px] transition-colors ${
        isActive ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
      } ${removed ? 'line-through' : ''}`}
    >
      <FileText className="h-3 w-3 shrink-0" />
      <span className="flex-1 truncate">
        <span className="text-muted-foreground/80">{c.topic}</span> · {c.subject}
      </span>
      <span
        className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
          removed ? 'bg-muted text-muted-foreground' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
        }`}
      >
        {removed ? 'removed' : 'new'}
      </span>
    </button>
  );
}

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
