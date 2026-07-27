/**
 * The Guard main pane: the spec doc as the coverage surface, with the spec
 * curation surface absorbed, presented through the shared preview/pin tab model
 * (the same {@link GuardTabStrip} + {@link useGuardTabs} idiom as Flows and
 * Runs). Sidebar doc rows open as doc tabs, conflicts as conflict tabs; the strip
 * renders only while ≥1 item tab is open, and carries NO Overview chip — with no
 * doc open the pane is already its own no-selection state: an onboarding empty
 * state picked from
 * the pipeline-stage flags (no corpus → scan; corpus but no generate → generate;
 * generated but no run → run) or "select a document". A doc tab renders that doc
 * with its per-section statuses, a filtering totals strip, and a within-doc detail
 * pane multiplexing a clicked section's FLOW list (the flows that traverse it —
 * never scenarios) and a clicked conflict's resolution detail. A conflict tab renders the full-pane SpecOverlapDetail (the
 * same five-option resolver the BL-Drift Spec tab uses). Doc/conflict selection
 * mirrors `?guard`/`?gconf`; the within-doc section detail stays `?gsec`.
 */

import { headingMatchKey } from '@/lib/heading-match';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, FileText, FlaskConical, GitMerge, Loader2, PlayCircle } from 'lucide-react';
import type { GuardSectionCoverageStatus, GuardStaleness } from '@truecourse/shared';
import {
  overlapKey,
  parseSpecKey,
  type SpecCorpusState,
} from '@/components/spec/SpecCorpusView';
import { SpecOverlapDetail } from '@/components/spec/SpecOverlapDetail';
import { DocMarkdown } from '@/components/spec/DocMarkdown';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import * as api from '@/lib/api';
import { tallyCapabilities } from '@/lib/guard-report';
import { useGuardCoverage } from '@/hooks/useGuardCoverage';
import { useGuardView } from '@/hooks/useGuardView';
import type { GuardCoverageTabsState } from '@/hooks/useGuardCoverageTabs';
import { GuardDocCoverage, type CoverageFilterMode } from './GuardDocCoverage';
import { GuardSectionDetail } from './GuardSectionDetail';
import { GuardTabStrip, type GuardTabStripItem } from './GuardTabStrip';
import { GuardTotalsStrip } from './GuardTotalsStrip';

const FILTER_MODE_KEY = 'truecourse:guardFilterMode';

/** Conflict tab ids are overlap keys; doc tab ids are plain refs. */
const isOverlapId = (id: string): boolean => id.startsWith('overlap::');

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

export function GuardCoveragePage({
  repoId,
  corpus,
  staleness,
  staleLoaded,
  prNumber = null,
  prRef,
  reloadKey = 0,
  tabs,
  onDecision,
}: {
  repoId: string;
  corpus: SpecCorpusState;
  staleness: GuardStaleness;
  staleLoaded: boolean;
  /** EE PR view: scope conflict resolution to this PR. Repo view when null. */
  prNumber?: number | null;
  /** EE PR view: the PR head SHA. Undefined in the OSS repo view. */
  prRef?: string;
  /** Bumped on a guard generate/run completion → refetch the per-doc coverage. */
  reloadKey?: number;
  /** The doc/conflict tab set (shared with the sidebar) + the within-doc section. */
  tabs: GuardCoverageTabsState;
  /** Fired after a verdict is recorded, so the page can refresh the spec Rescan dot. */
  onDecision?: () => void;
}) {
  const { activeId, openTabs, open, close, section, selectSection } = tabs;
  // The active tab is a conflict (its overlap key) or a doc (its ref); null = Overview.
  const activeConflict = activeId && isOverlapId(activeId) ? activeId : null;
  const doc = activeId && !activeConflict ? activeId : null;

  // A section's flow row jumps into the Flows tab (`?gflow=`) — scenarios are one
  // level deeper, inside the flow, never here.
  const { openGuardFlow } = useGuardView();

  const [filter, setFilter] = useState<GuardSectionCoverageStatus | null>(null);
  const [filterMode, setFilterMode] = useState<CoverageFilterMode>(() => {
    if (typeof window === 'undefined') return 'blur';
    return localStorage.getItem(FILTER_MODE_KEY) === 'hide' ? 'hide' : 'blur';
  });
  const changeFilterMode = useCallback((mode: CoverageFilterMode) => {
    setFilterMode(mode);
    try {
      localStorage.setItem(FILTER_MODE_KEY, mode);
    } catch {
      // Private-mode / storage-disabled: keep the in-session choice, skip persist.
    }
  }, []);
  const [content, setContent] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

  const { hasCorpus, hasGenerated, hasRun } = staleness;
  const docs = corpus.data?.corpus.docs ?? [];

  const { coverage, isLoading: coverageLoading, error: coverageError } = useGuardCoverage(
    repoId,
    doc,
    hasGenerated,
    reloadKey,
    prRef,
  );

  // The open conflict (if any) as its overlap parts — the spec curation surface
  // works whenever there's a corpus, so a conflict can be resolved before guards
  // are even generated.
  const overlapSel = useMemo(() => {
    if (!activeConflict) return null;
    const k = parseSpecKey(activeConflict);
    return k.kind === 'overlap' ? k : null;
  }, [activeConflict]);
  const showConflict = overlapSel != null && corpus.data != null;

  // Each open tab as its strip item: a doc labels by its repo-relative path, a
  // conflict by "a ↔ b" (both paths) — truncated in the strip, full on hover.
  const tabItems = useMemo<GuardTabStripItem[]>(
    () =>
      openTabs.map((t) => {
        if (isOverlapId(t.id)) {
          const k = parseSpecKey(t.id);
          const label = k.kind === 'overlap' ? `${k.a} ↔ ${k.b}` : t.id;
          return { ...t, label, title: label, icon: GitMerge };
        }
        return { ...t, label: t.id, title: t.id, icon: FileText };
      }),
    [openTabs],
  );

  // Fetch the raw markdown for the active doc (the coverage payload carries
  // section metadata, not the body). Same file the Spec tab reads.
  useEffect(() => {
    if (!doc) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setContent(null);
    setContentError(null);
    api
      .getSpecDoc(repoId, doc)
      .then((r) => !cancelled && setContent(r.content))
      .catch((e) => !cancelled && setContentError(e instanceof Error ? e.message : 'Failed to load document'));
    return () => {
      cancelled = true;
    };
  }, [repoId, doc]);

  // With a run present and a single doc, land straight on its coverage — unless a
  // tab is already active (auto-opening would fight a deep link). Pinned so the
  // lone doc's tab is stable.
  useEffect(() => {
    if (!activeId && hasRun && docs.length === 1) open(docs[0].ref, true);
  }, [activeId, hasRun, docs, open]);

  const selectedSection = useMemo(
    () => (section && coverage ? coverage.sections.find((s) => s.anchor === section) ?? null : null),
    [section, coverage],
  );

  // The blocked-on capability breakdown for THIS doc's grey sections — the
  // expansion of the totals strip's blocked-on chip (moved from the Report tab).
  const blockedOnCapabilities = useMemo(
    () =>
      coverage
        ? tallyCapabilities(
            coverage.sections
              .filter((s) => s.status === 'blocked-on')
              .map((s) => s.blockedOnCapabilities ?? []),
          )
        : [],
    [coverage],
  );

  // Headings in the current doc flagged by a within-area overlap → the conflict
  // key that resolves them. Reuses the same overlap `sections` the Spec doc viewer
  // marks (normalized heading text → overlap key).
  const conflictHeadings = useMemo(() => {
    const map = new Map<string, string>();
    if (!doc || !corpus.data) return map;
    for (const area of corpus.data.corpus.areas) {
      for (const ov of area.overlaps) {
        const key = overlapKey(area.id, ov.docs[0], ov.docs[1]);
        for (const s of ov.sections ?? []) {
          // A preamble pointer (null heading) has no heading row to tag — skip it.
          if (s.doc === doc && s.heading !== null) map.set(headingMatchKey(s.heading), key);
        }
      }
    }
    return map;
  }, [doc, corpus.data]);

  // --- The pane for the active tab (or the Overview) --------------------------
  const pane = (() => {
    // A conflict tab owns the WHOLE pane — its two columns carry their own doc
    // context, so no doc center renders beside it. Closing returns to the doc.
    if (showConflict) {
      return (
        <SpecOverlapDetail
          repoId={repoId}
          area={overlapSel!.area}
          docA={overlapSel!.a}
          docB={overlapSel!.b}
          data={corpus.data!}
          prNumber={prNumber}
          prRef={prRef}
          onResolved={(res) => {
            if (res) corpus.apply(res);
            else void corpus.refetch();
          }}
          onConflictChange={(list) => corpus.applyConflictResolutions(list)}
          onDecision={onDecision}
          onClose={() => close(activeConflict!)}
        />
      );
    }

    // Initial hydration: nothing determined yet.
    if (!staleLoaded && !coverage) {
      return (
        <Centered>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </Centered>
      );
    }

    if (!hasCorpus) {
      return (
        <EmptyState
          icon={BookOpen}
          title="No spec corpus"
          body={
            <>
              Run <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse spec scan</code> to curate the
              documents this coverage view reads.
            </>
          }
        />
      );
    }

    // Overview (no doc tab active): the stage CTAs, then "select a document". A
    // selected doc ALWAYS falls through to the render path below: raw markdown
    // pre-generate (conflicts stay resolvable in context), the coverage-banded
    // view once generated.
    if (!doc) {
      if (!hasGenerated) {
        return (
          <EmptyState
            icon={FlaskConical}
            title="No guards generated"
            body={
              <>
                Run <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard generate</code> to author
                scenarios for each spec section.
              </>
            }
          />
        );
      }
      if (!hasRun) {
        return (
          <EmptyState
            icon={PlayCircle}
            title="No guard run yet"
            body={
              <>
                Run <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard run</code> to test the
                scenarios and see pass/fail on the document.
              </>
            }
          />
        );
      }
      return (
        <EmptyState icon={BookOpen} title="Select a document" body="Choose a spec document to view its guard coverage." />
      );
    }

    // --- The detail pane: the flows through the selected section -------------
    const detailPane = selectedSection ? (
      <GuardSectionDetail
        section={selectedSection}
        onOpenFlow={openGuardFlow}
        onClose={() => selectSection(null)}
      />
    ) : null;

    // --- The center: the coverage-banded doc, or the raw doc before guards ----
    let center: React.ReactNode;
    if (coverageLoading || content == null) {
      center =
        coverageError || contentError ? (
          <Centered>
            <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">{coverageError ?? contentError}</p>
          </Centered>
        ) : (
          <Centered>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </Centered>
        );
    } else if (coverage) {
      center = (
        <GuardDocCoverage
          content={content}
          coverage={coverage}
          activeFilter={filter}
          filterMode={filterMode}
          selectedAnchor={selectedSection?.anchor ?? null}
          onSelectSection={selectSection}
          conflictHeadings={conflictHeadings}
          activeConflictKey={activeConflict}
          onOpenConflict={(key) => open(key, false)}
        />
      );
    } else {
      // Corpus present but no guard coverage (e.g. before generate) — show the doc so
      // conflicts stay resolvable in context.
      center = (
        <div className="h-full overflow-auto px-4 py-3 text-[13px] leading-relaxed text-foreground">
          <DocMarkdown source={content} />
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col">
        {hasGenerated && !hasRun && (
          <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <PlayCircle className="h-3.5 w-3.5 shrink-0" />
            <span>
              No guard run yet — statuses reflect generate-time coverage. Run{' '}
              <code className="rounded bg-amber-500/20 px-1 py-0.5">truecourse guard run</code> for pass/fail.
            </span>
          </div>
        )}

        {coverage && coverage.orphanedSections.length > 0 && (
          <HoverPopover portal
            width="wide"
            align="start"
            content={coverage.orphanedSections.map((o) => o.anchor).join('\n')}
          >
            <div className="border-b border-border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
              {coverage.orphanedSections.length} orphaned guard
              {coverage.orphanedSections.length === 1 ? '' : 's'} — section removed since generation
            </div>
          </HoverPopover>
        )}

        {coverage && (
          <GuardTotalsStrip
            totals={coverage.totals}
            activeFilter={filter}
            onFilter={setFilter}
            filterMode={filterMode}
            onFilterModeChange={changeFilterMode}
            blockedOnCapabilities={blockedOnCapabilities}
          />
        )}

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">{center}</div>
          {detailPane}
        </div>
      </div>
    );
  })();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* No Overview chip: with no doc open this pane IS its no-selection state
          (the stage CTA / "select a document"), not a second place to go. */}
      <GuardTabStrip
        tabs={tabItems}
        activeId={activeId}
        onSelect={(t) => open(t.id, t.pinned)}
        onClose={close}
      />
      <div className="min-h-0 flex-1 overflow-hidden">{pane}</div>
    </div>
  );
}
