/**
 * The Guard main pane: the spec doc as the coverage surface, with the spec
 * curation surface absorbed. Picks an onboarding empty state from the
 * pipeline-stage flags (no corpus → scan; corpus but no generate → generate;
 * generated but no run → run), else renders the selected doc with its per-section
 * statuses, a filtering totals strip, and a detail pane that multiplexes between a
 * clicked section's scenario detail and a clicked conflict's resolution detail
 * (the same five-option SpecOverlapDetail the BL-Drift Spec tab uses). The doc
 * picker and conflict list live in the sidebar (the reused SpecCorpusView);
 * selection flows through the URL (`?guard`/`?gsec`/`?gconf`). Read-only for
 * coverage; conflict resolution + force include/exclude are the spec decisions.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, FlaskConical, Loader2, PlayCircle } from 'lucide-react';
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
import { useGuardSelection } from '@/hooks/useGuardSelection';
import { GuardDocCoverage, type CoverageFilterMode } from './GuardDocCoverage';
import { GuardSectionDetail } from './GuardSectionDetail';
import { GuardTotalsStrip } from './GuardTotalsStrip';

const FILTER_MODE_KEY = 'truecourse:guardFilterMode';

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
}) {
  const { doc, section, conflict, selectDoc, selectSection, selectConflict } = useGuardSelection();
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
  );

  // The open conflict (if any) as its overlap parts — the spec curation surface
  // works whenever there's a corpus, so a conflict can be resolved before guards
  // are even generated.
  const overlapSel = useMemo(() => {
    if (!conflict) return null;
    const k = parseSpecKey(conflict);
    return k.kind === 'overlap' ? k : null;
  }, [conflict]);
  const showConflict = overlapSel != null && corpus.data != null;

  // Fetch the raw markdown for the selected doc (the coverage payload carries
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
  // conflict is deep-linked (auto-selecting a doc would clear it).
  useEffect(() => {
    if (!doc && !conflict && hasRun && docs.length === 1) selectDoc(docs[0].ref);
  }, [doc, conflict, hasRun, docs, selectDoc]);

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
          if (s.doc === doc) map.set(s.heading.trim().toLowerCase(), key);
        }
      }
    }
    return map;
  }, [doc, corpus.data]);

  // --- Onboarding empty states (driven by the staleness flags) ----------------
  // A selected conflict renders the curation surface even before guards exist, so
  // it takes precedence over the generate/run onboarding states below.
  if (!staleLoaded && !coverage && !showConflict) {
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
  if (!showConflict) {
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
    if (!doc) {
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
  }

  // --- The detail pane: a selected conflict wins over a selected section --------
  const detailPane = showConflict ? (
    <div className="flex min-w-0 flex-1 border-l border-border">
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
        onClose={() => selectConflict(null)}
      />
    </div>
  ) : selectedSection ? (
    <GuardSectionDetail
      repoId={repoId}
      section={selectedSection}
      runId={coverage?.runId ?? null}
      hasRun={hasRun}
      onClose={() => selectSection(null)}
    />
  ) : null;

  // --- The center: the coverage-banded doc, or the raw doc before guards exist --
  let center: React.ReactNode;
  if (!doc) {
    center = (
      <Centered>
        <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">
          Choose a spec document from the list to view its coverage.
        </p>
      </Centered>
    );
  } else if (coverageLoading || content == null) {
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
        activeConflictKey={conflict}
        onOpenConflict={selectConflict}
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

  // --- Coverage surface -------------------------------------------------------
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
        <HoverPopover
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
}
