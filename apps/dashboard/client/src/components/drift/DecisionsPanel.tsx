/**
 * Decisions tab — browsable, revokable ledger of every spec conflict
 * the user has resolved. Source of truth is
 * `.truecourse/specs/decisions.json`; the joined view (decision +
 * matching conflict) comes from the scan-state held in `SpecContext`.
 *
 * Out of scope for now: drift decisions (mute/snooze on Verify drifts).
 */

import { GitMerge, Loader2 } from 'lucide-react';
import { formatRelativeTime } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { useSpec } from '@/components/spec/SpecContext';
import type { SpecConflict, SpecDecision } from '@/lib/api';

type DecidedEntry = { conflict: SpecConflict; decision: SpecDecision };

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

interface DecisionsPanelProps {
  activeConflictId: string | null;
  onSelectConflict: (id: string | null) => void;
  /** PR / Git-Diff mode: decisions aren't per-commit, so there's no PR delta. */
  diffMode?: boolean;
}

export function DecisionsPanel({ activeConflictId, onSelectConflict, diffMode = false }: DecisionsPanelProps) {
  const { scan, hydrating, supportsRescan } = useSpec();

  // Decisions are a repo-wide ledger (resolved in the dashboard), not per-commit —
  // so a PR has no decisions delta. Don't show the full ledger as if it were the PR's.
  if (diffMode) {
    return (
      <EmptyState
        icon={GitMerge}
        title="No decisions diff"
        body="Decisions are repo-wide conflict resolutions made in the dashboard, not changes carried by a PR — so there's nothing to diff here. View them on the base branch."
      />
    );
  }

  if (hydrating) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!scan) {
    return (
      <EmptyState
        icon={GitMerge}
        title="No scan yet"
        body={
          supportsRescan ? (
            <>
              Click <strong>Scan</strong> on the Spec tab to start recording
              decisions.
            </>
          ) : (
            <>
              Decisions are recorded when you resolve a conflict on the Spec tab,
              which appears once this repository has been scanned.
            </>
          )
        }
      />
    );
  }

  const decided = scan.decidedConflicts;
  if (decided.length === 0) {
    return (
      <EmptyState
        icon={GitMerge}
        title="No decisions yet"
        body="Resolve conflicts in the Spec tab and they'll show up here as a revokable ledger."
      />
    );
  }

  // Group decisions by topic, with version-chains pulled into their
  // own pinned section (same convention as the Spec sidebar).
  const chains: DecidedEntry[] = [];
  const byTopic = new Map<string, DecidedEntry[]>();
  for (const entry of decided) {
    const isChain = entry.conflict.candidates[0]?.claim.id.startsWith(
      'version-chain:',
    );
    if (isChain) {
      chains.push(entry);
      continue;
    }
    const list = byTopic.get(entry.conflict.topic) ?? [];
    list.push(entry);
    byTopic.set(entry.conflict.topic, list);
  }
  const topicOrder = [...byTopic.keys()].sort(compareTopics);
  for (const t of topicOrder) {
    byTopic.set(
      t,
      (byTopic.get(t) ?? []).sort((a, b) =>
        a.conflict.subject.localeCompare(b.conflict.subject),
      ),
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        {chains.length > 0 && (
          <Section title="Version chains" count={chains.length}>
            {chains.map((entry) => (
              <DecisionRow
                key={entry.decision.conflictId}
                entry={entry}
                active={entry.decision.conflictId === activeConflictId}
                onSelect={() => onSelectConflict(entry.decision.conflictId)}
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
            {(byTopic.get(topic) ?? []).map((entry) => (
              <DecisionRow
                key={entry.decision.conflictId}
                entry={entry}
                active={entry.decision.conflictId === activeConflictId}
                onSelect={() => onSelectConflict(entry.decision.conflictId)}
              />
            ))}
          </Section>
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/80 px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{title}</span>
        <span>{count}</span>
      </div>
      {children}
    </div>
  );
}

function DecisionRow({
  entry,
  active,
  onSelect,
}: {
  entry: DecidedEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const { conflict, decision } = entry;
  const answer = answerSummary(entry);
  const isCustom = decision.resolution.kind === 'custom';
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-start gap-3 border-b border-border/60 px-4 py-2.5 text-xs transition-colors ${
        active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/40'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">
          {conflict.subject}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
              isCustom
                ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                : 'bg-muted/60 text-muted-foreground'
            }`}
          >
            {isCustom ? 'custom' : 'picked'}
          </span>
          <span className="truncate">{answer}</span>
        </div>
        {decision.note && (
          <div className="mt-1 text-[11px] italic text-muted-foreground">
            {decision.note}
          </div>
        )}
        <div
          className="mt-1 text-[10px] text-muted-foreground/70"
          title={new Date(decision.resolvedAt).toLocaleString()}
        >
          {formatRelativeTime(decision.resolvedAt)}
        </div>
      </div>
    </div>
  );
}

function answerSummary({ conflict, decision }: DecidedEntry): string {
  if (decision.resolution.kind === 'custom') {
    return truncate(decision.resolution.content, 140);
  }
  const idx = decision.resolution.candidateIndex;
  const candidate = conflict.candidates[idx];
  if (!candidate) return `candidate #${idx}`;
  const raw = candidate.claim.content;
  if (raw == null) return `candidate #${idx}`;
  return truncate(typeof raw === 'string' ? raw : JSON.stringify(raw), 140);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

