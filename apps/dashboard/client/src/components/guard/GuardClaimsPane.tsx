/**
 * The Claims tab's MAIN PANE — the shared {@link GuardTabStrip} (a permanent
 * Overview chip plus any opened claim, addressable as `?gclaim=`) over
 * {@link GuardClaimDetail}.
 *
 * The no-selection state IS a destination here, which is why the Overview chip
 * renders: the corpus only makes sense as a whole first. It answers how many
 * claims the docs make, how many of them anything actually proves, and which
 * documents carry the holes — then the reader picks one and reads its two traces.
 *
 * Nothing on this tab is an action. Claims are extracted by `guard generate`, so
 * an unextracted repo gets one empty state naming the command rather than a
 * button that would do the extraction from here.
 */

import { FileText, Loader2, Quote } from 'lucide-react';
import type { GuardClaimsView } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import type { GuardTabsState } from '@/hooks/useGuardTabs';
import { formatGuardTime } from '@/lib/guard-drifts';
import {
  GUARD_CLAIM_COVERAGE,
  findGuardClaimSelection,
  groupGuardClaims,
  type GuardUntestableEntry,
} from '@/lib/guard-claims';
import { GuardClaimDetail, GuardUntestableDetail } from './GuardClaimDetail';
import { GuardTabStrip, type GuardTabStripItem } from './GuardTabStrip';

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

/** One count of the totals row — the number first, its word under it. */
function Stat({ value, label, hint }: { value: number; label: string; hint: string }) {
  return (
    <HoverPopover portal width="narrow" content={hint}>
      <span className="flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2.5 py-1.5">
        <span className="text-sm font-semibold text-foreground">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </span>
    </HoverPopover>
  );
}

/**
 * The corpus at a glance: what the docs claim, how much of it anything proves,
 * and the per-document breakdown that says WHERE the unproven part is.
 */
function ClaimsOverview({ view, untestable }: { view: GuardClaimsView; untestable: GuardUntestableEntry[] }) {
  const t = view.totals;
  const docs = groupGuardClaims(view.claims, untestable);

  return (
    <div role="region" aria-label="Claims overview" className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Extracted claims
        </div>
        <div className="flex flex-wrap gap-2">
          <Stat value={t.claims} label="claims" hint="Testable statements extracted from the curated docs." />
          <Stat value={t.proven} label="proven" hint={GUARD_CLAIM_COVERAGE.proven.hint} />
          <Stat value={t.planned} label="planned" hint={GUARD_CLAIM_COVERAGE.planned.hint} />
          <Stat value={t.gapped} label="gapped" hint={GUARD_CLAIM_COVERAGE.gapped.hint} />
          <Stat value={t.unplanned} label="unplanned" hint={GUARD_CLAIM_COVERAGE.unplanned.hint} />
        </div>
        <p className="text-[12px] text-muted-foreground">
          {t.dismissed} dismissed · {t.untestable} not claimed · {t.orphanedAnchors} with an anchor the live doc no
          longer has
          {view.generatedAt ? ` · extracted ${formatGuardTime(view.generatedAt)}` : ''}
        </p>

        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            By document
          </div>
          <div role="list" aria-label="Claims by document" className="rounded border border-border">
            {docs.map((group) => {
              const claims = group.sections.flatMap((s) => s.claims);
              const proven = claims.filter((c) => c.coverage === 'proven').length;
              return (
                <div
                  key={group.doc}
                  role="listitem"
                  className="flex items-baseline gap-2 border-b border-border/60 px-3 py-2 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{group.doc}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {claims.length} claim{claims.length === 1 ? '' : 's'} · {proven} proven
                    {group.untestable.length > 0 ? ` · ${group.untestable.length} not claimed` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-muted-foreground">
          A claim is one testable statement your documentation makes. Every flow guard writes is built out of these,
          so a claim nothing carries is a promise nothing tests. Pick one to read the section it came from and the
          flows and scenario steps that stand behind it.
        </p>
      </div>
    </div>
  );
}

export function GuardClaimsPane({
  view,
  untestable,
  loading,
  error,
  tabs,
  onOpenSpec,
  onOpenFlow,
  onOpenTest,
}: {
  view: GuardClaimsView | null;
  /** The refused statements with the ids the tab set addresses them by. */
  untestable: GuardUntestableEntry[];
  loading: boolean;
  error: string | null;
  tabs: GuardTabsState;
  onOpenSpec: (doc: string, anchor: string) => void;
  onOpenFlow: (flowId: string) => void;
  onOpenTest: (scenarioId: string) => void;
}) {
  const { activeId, openTabs, open, close, selectOverview } = tabs;

  if (loading && !view) {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Centered>
    );
  }
  if (error && !view) {
    return (
      <Centered>
        <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">{error}</p>
      </Centered>
    );
  }
  if (!view) {
    return <EmptyState icon={Quote} title="No claim corpus" body="Claims are extracted from the curated spec docs." />;
  }

  const selection = findGuardClaimSelection(view, untestable, activeId);
  const tabItems: GuardTabStripItem[] = openTabs.map((t) => {
    const item = findGuardClaimSelection(view, untestable, t.id);
    return {
      ...t,
      label: item ? (item.kind === 'claim' ? item.claim.title : item.row.text) : t.id,
      title: t.id,
      icon: item?.kind === 'untestable' ? FileText : Quote,
    };
  });

  const body = (() => {
    if (!view.extracted) {
      return (
        <EmptyState
          icon={Quote}
          title="No claims extracted yet"
          body={
            <>
              Claims are extracted while guard authors your flows — run{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard generate</code> to read what your
              documentation promises.
            </>
          }
        />
      );
    }
    if (!selection) return <ClaimsOverview view={view} untestable={untestable} />;
    return selection.kind === 'claim' ? (
      <GuardClaimDetail
        claim={selection.claim}
        onOpenSpec={onOpenSpec}
        onOpenFlow={onOpenFlow}
        onOpenTest={onOpenTest}
      />
    ) : (
      <GuardUntestableDetail row={selection.row} onOpenSpec={onOpenSpec} />
    );
  })();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <GuardTabStrip
        tabs={tabItems}
        activeId={activeId}
        onSelect={(t) => open(t.id, t.pinned)}
        onSelectOverview={selectOverview}
        onClose={close}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">{body}</div>
    </div>
  );
}
