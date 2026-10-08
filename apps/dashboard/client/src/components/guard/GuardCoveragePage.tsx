/**
 * The corpus main pane, presented through the shared preview/pin tab model (the
 * {@link useGuardTabs} idiom Flows and Runs use). Sidebar doc rows open as doc
 * tabs, conflicts as conflict tabs; with no tab open the pane is AT REST on the
 * {@link GuardCoverageOverview}: the corpus-wide numbers, read-only, nothing
 * clickable. It is not a second reading of the corpus's doc LIST (the sidebar
 * beside it is that), and not a pipeline-stage CTA (the header's own Scan /
 * Generate / Run buttons are).
 *
 * A doc tab renders the document as its text and nothing else: what the
 * document promises and how each promise stands is read on Context's Claims,
 * claim by claim. A conflict tab renders the full-pane SpecConflictDetail (the
 * same five-option resolver Context's conflicts use). Doc/conflict selection
 * mirrors `?doc`/`?conflict`.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { GuardStaleness } from '@truecourse/shared';
import { buildCorpusConflicts, isConflictId, resolveConflictId } from '@truecourse/shared';
import { parseSpecKey, type SpecCorpusState } from '@/components/spec/SpecCorpusView';
import { SpecConflictDetail } from '@/components/spec/SpecConflictDetail';
import { DocFacts } from '@/components/spec/DocFacts';
import { DocMarkdown } from '@/components/spec/DocMarkdown';
import * as api from '@/lib/api';
import type { GuardCoverageTabsState } from '@/hooks/useGuardCoverageTabs';
import { GuardCoverageOverview } from '@/components/guard/GuardCoverageOverview';

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

export function GuardCoveragePage({
  repoId,
  corpus,
  staleness,
  staleLoaded,
  reloadKey = 0,
  tabs,
  onDecision,
}: {
  repoId: string;
  corpus: SpecCorpusState;
  staleness: GuardStaleness;
  staleLoaded: boolean;
  /** Bumped on a guard generate/run completion → refetch the overview. */
  reloadKey?: number;
  /** The doc/conflict tab set (shared with the sidebar). */
  tabs: GuardCoverageTabsState;
  /** Fired after a verdict is recorded, so the page can refresh the spec Rescan dot. */
  onDecision?: () => void;
}) {
  const { activeId, openTabs, open } = tabs;
  // The active tab is a conflict (its key) or a doc (its ref); null = nothing open.
  const activeConflict = activeId && isConflictId(activeId) ? activeId : null;
  const doc = activeId && !activeConflict ? activeId : null;

  const [content, setContent] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

  const { hasRun } = staleness;
  const docs = corpus.data?.corpus.docs ?? [];

  // The open conflict (if any) as its key's parts, the spec curation surface
  // works whenever there's a corpus, so a conflict can be resolved before guards
  // are even generated.
  const conflictSel = useMemo(() => {
    if (!activeConflict) return null;
    const k = parseSpecKey(activeConflict);
    return k.kind === 'conflict' ? k : null;
  }, [activeConflict]);
  const showConflict = conflictSel != null && corpus.data != null;

  // The shared derivation over the whole corpus, the ONE conflict list this page
  // addresses by id.
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
  // The conflict the URL names. A doc PAIR can carry several genuine conflicts, so
  // this must resolve the ID, a lookup by pair would always land on the first.
  const activeConflictRecord = useMemo(
    () => (activeConflict ? resolveConflictId(conflicts, activeConflict) : undefined),
    [conflicts, activeConflict],
  );

  // Fetch the raw markdown for the active doc. Same file the Context document
  // pane reads.
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

  // With a run present and a single doc, land straight on it, unless a tab is
  // already active (auto-opening would fight a deep link) or open (a deliberate
  // Overview deselect must not bounce back to the doc). Pinned so the lone
  // doc's tab is stable.
  useEffect(() => {
    if (!activeId && openTabs.length === 0 && hasRun && docs.length === 1) open(docs[0].ref, true);
  }, [activeId, openTabs, hasRun, docs, open]);

  const pane = (() => {
    // A conflict tab owns the WHOLE pane, its two columns carry their own doc
    // context, so no doc center renders beside it. Closing returns to the doc.
    if (showConflict) {
      return (
        <SpecConflictDetail
          repoId={repoId}
          area={activeConflictRecord?.area ?? conflictSel!.area}
          docA={activeConflictRecord?.a ?? conflictSel!.a}
          docB={activeConflictRecord?.b ?? conflictSel!.b}
          conflict={activeConflictRecord}
          data={corpus.data!}
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
    if (!doc) {
      return (
        <GuardCoverageOverview
          repoId={repoId}
          docsCount={docs.length}
          staleness={staleness}
          reloadKey={reloadKey}
        />
      );
    }

    if ((!staleLoaded && content == null) || (content == null && !contentError)) {
      return (
        <Centered>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </Centered>
      );
    }
    if (content == null) {
      return (
        <Centered>
          <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">{contentError}</p>
        </Centered>
      );
    }

    return (
      <div className="h-full overflow-auto px-4 py-3 text-[13px] leading-relaxed text-foreground">
        {/* A synced ticket's own facts, above the ticket. The renderer hides the
            frontmatter they come from; a doc that states none renders nothing. */}
        <DocFacts source={content} />
        <DocMarkdown source={content} />
      </div>
    );
  })();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">{pane}</div>
    </div>
  );
}
