/**
 * The Guard main pane: the spec doc as the coverage surface, with the spec
 * curation surface absorbed, presented through the shared preview/pin tab model
 * (the same {@link GuardTabStrip} + {@link useGuardTabs} idiom as Flows and
 * Runs). Sidebar doc rows open as doc tabs, conflicts as conflict tabs; the strip
 * renders only while ≥1 item tab is open, and carries NO Overview chip, with no
 * doc open the pane is AT REST on the {@link GuardCoverageOverview}: the
 * corpus-wide numbers, read-only, nothing clickable. It is not a second reading
 * of the corpus's doc LIST (the sidebar beside it is that), and not a
 * pipeline-stage CTA (the header's own Scan / Generate / Run buttons are). A doc
 * tab renders that doc
 * with its per-section statuses, a filtering totals strip, and a within-doc detail
 * pane multiplexing a clicked section's FLOW list (the flows that traverse it -
 * never scenarios) with the CLAIMS that section states, and a clicked
 * conflict's resolution detail. Claims live HERE and nowhere else: a section says
 * what it promises, and one of those promises drills into the claim itself -
 * both traces included, without leaving the document.
 * A conflict tab renders the full-pane SpecOverlapDetail (the
 * same five-option resolver the BL-Drift Spec tab uses). Doc/conflict selection
 * mirrors `?guard`/`?gconf`; the within-doc section detail stays `?gsec`, and the
 * claim read inside it `?gclaim`. The
 * registered llms.txt sites some of these docs are fetched from are managed on
 * their own Sources page, the doc surface only ever READS them.
 */

import { headingMatchKey } from '@/lib/heading-match';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  GitMerge,
  Loader2,
  PlayCircle,
} from 'lucide-react';
import type { GuardClaimsView, GuardCoveragePlainStatus, GuardStaleness } from '@/preview/vendor/shared';
import { buildCorpusConflicts, isConflictId, resolveConflictId } from '@/preview/vendor/shared';
import { parseSpecKey, type SpecCorpusState } from '@/preview/vendor/components/spec/SpecCorpusView';
import { SpecOverlapDetail } from '@/preview/vendor/components/spec/SpecOverlapDetail';
import { DocMarkdown } from '@/components/spec/DocMarkdown';
import { SpecScanButton } from '@/preview/vendor/components/spec/SpecScanButton';
import { WebSourceBadge } from '@/preview/vendor/components/spec/WebSourceBadge';
import { HoverPopover } from '@/preview/ui/hover-popover';
import { useCapability } from '@/contexts/CapabilityContext';
import * as api from '@/preview/vendor/lib/api';
import { tallyCapabilities, tallyNeedsSetup } from '@/preview/vendor/lib/guard-report';
import { findGuardClaimSelection, type GuardUntestableEntry } from '@/preview/vendor/lib/guard-claims';
import { corpusHasDoc, parseWebDocRef, webDocLabel } from '@/preview/vendor/lib/spec-web-source';
import { useGuardCoverage } from '@/preview/vendor/hooks/useGuardCoverage';
import { useGuardView } from '@/preview/vendor/hooks/useGuardView';
import type { GuardCoverageTabsState } from '@/preview/vendor/hooks/useGuardCoverageTabs';
import { GuardCoverageOverview } from '@/preview/vendor/components/guard/GuardCoverageOverview';
import { GuardDocCoverage, type CoverageFilterMode } from '@/preview/vendor/components/guard/GuardDocCoverage';
import { GuardSectionDetail } from '@/preview/vendor/components/guard/GuardSectionDetail';
import { GuardTabStrip, type GuardTabStripItem } from '@/preview/vendor/components/guard/GuardTabStrip';
import { GuardTotalsStrip } from '@/preview/vendor/components/guard/GuardTotalsStrip';

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
  tabs,
  claims = null,
  untestable = [],
  onDecision,
}: {
  repoId: string;
  corpus: SpecCorpusState;
  staleness: GuardStaleness;
  staleLoaded: boolean;
  /** The claim corpus, read inside the section that states each claim. */
  claims?: GuardClaimsView | null;
  /** The refused statements with the ids `?gclaim` addresses them by. */
  untestable?: GuardUntestableEntry[];
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
  const { activeId, openTabs, open, close, deselect, section, selectSection, claim, selectClaim, focusClaim } = tabs;
  // The active tab is a conflict (its overlap key) or a doc (its ref); null = nothing open.
  const activeConflict = activeId && isConflictId(activeId) ? activeId : null;
  const doc = activeId && !activeConflict ? activeId : null;

  // A section's flow row jumps into the Tests tab (`?flow=`), and a claim's
  // source line to the doc section that states it.
  const { openGuardFlow, openSpecSection, openGuardExternals } = useGuardView();

  // A `?claim=` deep link (or a jump that carries only the claim id) names a
  // claim, not a place: resolve it to its doc + section and land all three in ONE
  // write, so the claim can be read where it is stated.
  useEffect(() => {
    if (!claim) return;
    const found = findGuardClaimSelection(claims, untestable, claim);
    if (!found) return;
    const target = found.kind === 'claim' ? found.claim : found.row;
    if (doc === target.doc && section === target.anchor) return;
    focusClaim(claim, target.doc, target.anchor);
  }, [claim, claims, untestable, doc, section, focusClaim]);

  const [filter, setFilter] = useState<GuardCoveragePlainStatus | null>(null);
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

  const { hasGenerated, hasRun } = staleness;
  const docs = corpus.data?.corpus.docs ?? [];

  const { coverage, isLoading: coverageLoading, error: coverageError } = useGuardCoverage(
    repoId,
    doc,
    hasGenerated,
    reloadKey,
    prRef,
  );

  // The open conflict (if any) as its overlap parts, the spec curation surface
  // works whenever there's a corpus, so a conflict can be resolved before guards
  // are even generated.
  const overlapSel = useMemo(() => {
    if (!activeConflict) return null;
    const k = parseSpecKey(activeConflict);
    return k.kind === 'overlap' ? k : null;
  }, [activeConflict]);
  const showConflict = overlapSel != null && corpus.data != null;

  // The shared derivation over the whole corpus, the ONE conflict list this page
  // addresses by id, for both the resolution pane and the in-doc heading markers.
  const conflicts = useMemo(
    () =>
      corpus.data
        ? buildCorpusConflicts(corpus.data.corpus, {
            manualExcludes: corpus.data.manualExcludes ?? [],
            conflictResolutions: corpus.data.conflictResolutions ?? [],
          })
        : [],
    [corpus.data],
  );
  // The dispute the URL names. A doc PAIR can carry several genuine disputes, so
  // this must resolve the ID, a lookup by pair would always land on the first.
  // Legacy `?conflict=` links (minted before ids carried a section discriminator)
  // still resolve, to the first dispute of their pair: the row they always opened.
  const activeConflictRecord = useMemo(
    () => (activeConflict ? resolveConflictId(conflicts, activeConflict) : undefined),
    [conflicts, activeConflict],
  );

  // The corpus's web-source pages, by ref: a page fetched from a registered
  // llms.txt site reads as `<site> / <page>` wherever its raw snapshot ref would
  // otherwise show, and links out to the page it was fetched from.
  const webDocs = useMemo(
    () => new Map((corpus.data?.corpus.docs ?? []).filter((d) => d.origin === 'web').map((d) => [d.ref, d])),
    [corpus.data],
  );
  const docLabel = useCallback(
    (ref: string): string => webDocLabel(ref, webDocs.get(ref)?.sourceTitle) ?? ref,
    [webDocs],
  );

  // A fetched page the corpus does not know, a `?doc=<sourceRef>` deep link
  // followed before the scan folded it in (or a page added after the last one).
  // The snapshot is a real file, so it renders; nothing else on this tab has a
  // row for it, so the doc says so instead of looking like a corpus doc.
  const unscannedSource = useMemo(
    () =>
      doc && !corpus.hydrating && !corpusHasDoc(corpus.data, doc) ? parseWebDocRef(doc) : null,
    [doc, corpus.hydrating, corpus.data],
  );
  // Scanning needs a working tree; hosted repos re-scan themselves, so the CTA
  // (not the caution) is `local-filesystem`-gated exactly like the header's.
  const canScan = useCapability('local-filesystem');

  // Each open tab as its strip item: a doc labels by its repo-relative path (a
  // fetched page by its source + page), a conflict by "a ↔ b", truncated in the
  // strip, full on hover.
  const tabItems = useMemo<GuardTabStripItem[]>(
    () =>
      openTabs.map((t) => {
        if (isConflictId(t.id)) {
          const k = parseSpecKey(t.id);
          const label = k.kind === 'overlap' ? `${docLabel(k.a)} ↔ ${docLabel(k.b)}` : t.id;
          return { ...t, label, title: label, icon: GitMerge };
        }
        return { ...t, label: docLabel(t.id), title: t.id, icon: FileText };
      }),
    [openTabs, docLabel],
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

  // With a run present and a single doc, land straight on its coverage, unless a
  // tab is already active (auto-opening would fight a deep link) or open (a
  // deliberate Overview deselect must not bounce back to the doc). Pinned so the
  // lone doc's tab is stable.
  useEffect(() => {
    if (!activeId && openTabs.length === 0 && hasRun && docs.length === 1) open(docs[0].ref, true);
  }, [activeId, openTabs, hasRun, docs, open]);

  const selectedSection = useMemo(
    () => (section && coverage ? coverage.sections.find((s) => s.anchor === section) ?? null : null),
    [section, coverage],
  );

  // The blocked-on capability breakdown for THIS doc's blocked sections, part of
  // the expansion of the totals strip's Blocked chip (moved from the Report tab).
  // WHICH blocker is a detail; the counter itself is just "Blocked".
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

  // The per-SERVICE breakdown of the blocked sections a user can clear TODAY, the
  // other half of the Blocked chip's expansion, and the rows that link to the
  // Dependencies page that clears them.
  const needsSetupServices = useMemo(
    () =>
      coverage
        ? tallyNeedsSetup(
            coverage.sections.filter((s) => s.status === 'needs-setup').map((s) => s.needsSetup),
          )
        : [],
    [coverage],
  );

  // Headings in the current doc flagged by a within-area overlap → the conflict
  // key that resolves them. Reuses the same overlap `sections` the Spec doc viewer
  // marks (normalized heading text → overlap key).
  const conflictHeadings = useMemo(() => {
    const map = new Map<string, string>();
    if (!doc) return map;
    for (const cf of conflicts) {
      for (const s of cf.sections ?? []) {
        // A preamble pointer (null heading) has no heading row to tag, skip it.
        if (s.doc === doc && s.heading !== null) map.set(headingMatchKey(s.heading), cf.id);
      }
    }
    return map;
  }, [doc, conflicts]);

  // --- The pane for the active tab (or the Overview) --------------------------
  const pane = (() => {
    // A conflict tab owns the WHOLE pane, its two columns carry their own doc
    // context, so no doc center renders beside it. Closing returns to the doc.
    if (showConflict) {
      return (
        <SpecOverlapDetail
          repoId={repoId}
          area={activeConflictRecord?.area ?? overlapSel!.area}
          docA={activeConflictRecord?.a ?? overlapSel!.a}
          docB={activeConflictRecord?.b ?? overlapSel!.b}
          conflict={activeConflictRecord}
          data={corpus.data!}
          prNumber={prNumber}
          prRef={prRef}
          onResolved={(res) => {
            if (res) corpus.apply(res);
            else void corpus.refetch();
          }}
          onConflictChange={(list) => corpus.applyConflictResolutions(list)}
          onDecision={onDecision}
        />
      );
    }

    // No doc tab active: the pane is AT REST on the corpus-wide Overview -
    // mounted immediately (it owns its loading state), so its status fetch
    // starts in the first request wave instead of after hydration.
    // read-only numbers, nothing clickable (the sidebar is where a doc opens).
    // A selected doc ALWAYS falls through to the render path below, including
    // before the first scan, where a doc opened by hand (a page of a registered
    // web source, say) is a real file on disk with no coverage bands yet.
    if (!doc) {
      return (
        <GuardCoverageOverview
          repoId={repoId}
          docsCount={docs.length}
          claims={claims}
          staleness={staleness}
          reloadKey={reloadKey}
          {...(prRef ? { prRef } : {})}
        />
      );
    }

    // Initial hydration of a doc path: nothing determined yet.
    if (!staleLoaded && !coverage) {
      return (
        <Centered>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </Centered>
      );
    }

    // --- The detail pane: the flows through the selected section -------------
    const detailPane = selectedSection ? (
      <GuardSectionDetail
        repoId={repoId}
        section={selectedSection}
        doc={doc}
        claims={claims?.claims ?? []}
        untestable={untestable}
        activeClaimId={claim}
        {...(prRef ? { prRef } : {})}
        onSelectClaim={selectClaim}
        onOpenFlow={openGuardFlow}
        onOpenSpec={openSpecSection}
        onOpenExternals={openGuardExternals}
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
      // Corpus present but no guard coverage (e.g. before generate), show the doc so
      // conflicts stay resolvable in context.
      center = (
        <div className="h-full overflow-auto px-4 py-3 text-[13px] leading-relaxed text-foreground">
          <DocMarkdown source={content} />
        </div>
      );
    }

    const webDoc = webDocs.get(doc);

    return (
      <div className="flex h-full flex-col">
        {webDoc && (
          // A fetched page is not this repo's writing, say where it came from and
          // link to the live page, so a stale snapshot is one click from the truth.
          <div className="flex items-center gap-2 border-b border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            <WebSourceBadge />
            <span className="truncate">{webDoc.sourceTitle ?? webDoc.sourceId}</span>
            {webDoc.url && (
              <a
                href={webDoc.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 truncate text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{webDoc.url}</span>
              </a>
            )}
          </div>
        )}
        {unscannedSource && (
          <div className="flex items-center gap-2 border-b border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[11px] text-sky-700 dark:text-sky-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              Fetched from <span className="font-medium">{unscannedSource.sourceId}</span> but not
              scanned yet, Scan folds it into the corpus.
            </span>
            {canScan && (
              <span className="ml-auto shrink-0">
                <SpecScanButton
                  hasCorpus={corpus.data != null}
                  scanning={corpus.scanning}
                  decisionsPending={false}
                  docsChanged={false}
                  onClick={() => void corpus.scan()}
                />
              </span>
            )}
          </div>
        )}
        {hasGenerated && !hasRun && (
          <div className="flex items-center gap-2 border-b border-border bg-sky-500/10 px-3 py-1.5 text-[11px] text-sky-700 dark:text-sky-300">
            <PlayCircle className="h-3.5 w-3.5 shrink-0" />
            <span>
              No run yet, run <code className="rounded bg-sky-500/20 px-1 py-0.5">truecourse guard run</code> for
              pass/fail.
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
              Orphaned tests, their section was removed since generation
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
            needsSetupServices={needsSetupServices}
            onOpenExternals={openGuardExternals}
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
      <GuardTabStrip
        tabs={tabItems}
        activeId={activeId}
        onSelect={(t) => open(t.id, t.pinned)}
        onClose={close}
        home={{ label: 'Overview', onSelect: deselect }}
      />
      <div className="min-h-0 flex-1 overflow-hidden">{pane}</div>
    </div>
  );
}
