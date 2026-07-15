/**
 * A birth-finding tab's MAIN-PANE detail — the GuardScenarioDetail analog for a
 * finding row. A finding is a candidate scenario that failed birth validation twice
 * and was NOT committed as a guard, so the developer must judge "generation defect
 * or real drift." To make that call ON ONE SCREEN (plan item 19) the detail shows
 * everything: the binding (doc § section + view-in-spec), the failed step's
 * expected/actual, the authored scenario YAML (the exact commands it ran), and the
 * full evidence transcript from disk (fetched on mount, the same viewer the
 * run-failure detail uses). A finding the user judges noise is dismissible (item
 * 20): the action writes `decisions.json` and the next generate skips the claim;
 * until then the report snapshot still lists it, so a dismissed finding shows an
 * Un-dismiss + "takes effect next generate" note. Read-only otherwise; drift-vs-
 * defect is theirs. Rendered as tab content, so the tab strip owns the close.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Ban } from 'lucide-react';
import * as api from '@/lib/api';
import type { GuardClaimIdentity } from '@/lib/api';
import { sectionLeaf } from '@/lib/guard-drifts';
import type { GuardFindingRowData } from '@/lib/guard-list-rows';
import { GuardFindingBadge } from './GuardFindingBadge';
import { PRE } from './detail-styles';
import { GuardProgramOutput } from './GuardProgramOutput';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
const BTN =
  'inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground';

export function GuardFindingDetail({
  repoId,
  row,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for RepoPage's wiring; the tab strip owns the close now (unused, clean up later)
  onClose,
  onOpenSpec,
  onDismiss,
  onUndismiss,
}: {
  repoId: string;
  row: GuardFindingRowData;
  /** Unused — the tab strip's X is the only close. Kept for the RepoPage caller. */
  onClose: () => void;
  onOpenSpec: (doc: string, section: string) => void;
  /** Dismiss this finding's claim (writes decisions.json); parent refetches decisions. */
  onDismiss: (claim: GuardClaimIdentity) => Promise<void>;
  /** Reverse the dismissal. */
  onUndismiss: (claim: GuardClaimIdentity) => Promise<void>;
}) {
  const f = row.finding;

  // Evidence transcript — the full birth-validation transcript from disk, fetched
  // on mount and shown expanded (the reader came to read it). The parent keys this
  // component by finding id, so a selection change resets all state; the mounted
  // ref closes the async gap so a stale fetch never writes the wrong pane.
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!f.evidencePath) return;
    setBusy(true);
    api
      .getGuardFindingEvidence(repoId, f.evidencePath)
      .then((text) => {
        if (mounted.current) setEvidence(text);
      })
      .catch((e) => {
        if (mounted.current) setEvidence(e instanceof Error ? e.message : 'Evidence unavailable.');
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  }, [repoId, f.evidencePath]);

  // The dismissal identity keys on the extracted claim's stable text (`f.claim`),
  // not the scenario title — the same identity generate matches. An old report with
  // no `claim` can't be dismissed (nothing to key on); the action hides.
  const claimIdentity: GuardClaimIdentity | null = f.claim
    ? { doc: f.doc, anchor: f.anchor, title: f.claim }
    : null;
  const runDismiss = useCallback(
    async (fn: (c: GuardClaimIdentity) => Promise<void>) => {
      if (!claimIdentity) return;
      setDismissing(true);
      try {
        await fn(claimIdentity);
      } finally {
        if (mounted.current) setDismissing(false);
      }
    },
    [claimIdentity],
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header — title is primary; the section slug rides as small mono meta. */}
      <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GuardFindingBadge />
            {row.dismissed && (
              <span className="shrink-0 rounded bg-zinc-400/15 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:text-zinc-400">
                dismissed
              </span>
            )}
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {row.headingText ?? sectionLeaf(row.anchor)}
            </span>
          </div>
          <h2
            className={`mt-1 text-sm font-semibold ${
              row.dismissed ? 'text-muted-foreground line-through' : 'text-foreground'
            }`}
          >
            {f.title}
          </h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-auto px-6 py-4">
        {/* Binding + actions — "View in spec" and "Dismiss finding" share one row.
            A dismissal takes effect on the next generate (the report is a snapshot),
            so a dismissed finding still lists here with an Un-dismiss + note. */}
        <div>
          <div className={LABEL}>Binding</div>
          <div className="break-all font-mono text-sm text-foreground">{f.doc}</div>
          <div className="break-all text-sm leading-relaxed text-muted-foreground">§ {f.anchor}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onOpenSpec(f.doc, f.anchor)} className={BTN}>
              View in spec
              <ArrowUpRight className="h-3 w-3" />
            </button>
            {claimIdentity &&
              (row.dismissed ? (
                <button
                  type="button"
                  disabled={dismissing}
                  onClick={() => void runDismiss(onUndismiss)}
                  className={`${BTN} disabled:opacity-50`}
                >
                  <Ban className="h-3 w-3" />
                  {dismissing ? 'Working…' : 'Un-dismiss'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={dismissing}
                  onClick={() => void runDismiss(onDismiss)}
                  className={`${BTN} disabled:opacity-50`}
                >
                  <Ban className="h-3 w-3" />
                  {dismissing ? 'Working…' : 'Dismiss finding'}
                </button>
              ))}
          </div>
          {claimIdentity && row.dismissed && (
            <div className="mt-1.5 text-[11px] text-muted-foreground">Dismissed — takes effect next generate.</div>
          )}
        </div>

        {/* Blast radius — resolving this finding releases its section's held work. */}
        {row.heldCount > 0 && (
          <div className="text-[13px] font-medium text-amber-600 dark:text-amber-400">
            Holds back {row.heldCount} ready scenario{row.heldCount === 1 ? '' : 's'}.
          </div>
        )}

        {/* What went wrong */}
        <div>
          <div className={LABEL}>
            Failed at step <span className="text-foreground">{f.step}</span>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Expected</span>
            <pre className={PRE}>{f.expected}</pre>
          </div>
          <div className="mt-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Actual</span>
            <pre className={PRE}>{f.actual}</pre>
          </div>
          {/* The failing run's raw program output (Fix 1) — render-if-present; a
              fidelity finding has no program run, so it simply shows nothing. */}
          <GuardProgramOutput stdout={f.stdout} stderr={f.stderr} />
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">
          A candidate scenario for this section failed birth validation twice — a generation defect or real drift. It
          was not committed as a guard; regenerate once the section (or the engine) is fixed, or dismiss it as noise.
        </p>

        {/* Evidence — the full transcript from disk (never truncated), the same
            viewer the run-failure detail embeds, always expanded. */}
        {f.evidencePath && (
          <div>
            <div className={LABEL}>Evidence</div>
            <pre className={PRE} aria-label="evidence transcript">
              {busy ? 'Loading transcript…' : evidence ?? ''}
            </pre>
          </div>
        )}

        {/* The authored YAML the candidate ran — same code-block idiom as the held /
            scenario-source detail; it rides inline on the finding (item 19). */}
        {f.yaml && (
          <div>
            <div className={LABEL}>Scenario source</div>
            <pre className={PRE} aria-label="scenario source">
              {f.yaml}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
