/**
 * The coverage surface: the spec doc rendered in full, each section carrying its
 * guard status as a subtle left-edge band (never banner noise). A tiny corner
 * dot per statused section reveals the precise status + reason on hover
 * (HoverPopover); clicking the section opens its detail. Sections are
 * data-addressable (`data-anchor`) so a selection or a totals-strip filter jumps
 * the matching section into view, the deep-link target for the drifts page.
 *
 * A section can be both covered and conflicted. A conflicted heading (one flagged
 * by a within-area spec overlap) gets a small "conflict" TAG alongside its status
 * dot, never a second band, that opens the overlap's resolution detail. When a
 * conflict is the active selection, its heading scrolls into view too.
 *
 * Rendering is per-section-chunk and memoized: each chunk parses its markdown
 * once (keyed on its text) and only re-renders when its OWN status/selection
 * changes, so clicking a section repaints two chunks, not all ~310. Standalone
 * `<a id>` anchor lines are stripped so they never show as literal text, and
 * in-document cross-reference links (`#anchor`) are intercepted to select+scroll
 * the target section rather than open a new tab. A status filter either blurs
 * (dims in place) or hides (collapses) the non-matching sections.
 */

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { GitMerge } from 'lucide-react';
import { guardCoveragePlainStatus } from '@/preview/vendor/shared';
import type {
  GuardCoveragePlainStatus,
  GuardDocCoverage as GuardDocCoverageData,
  GuardSectionCoverageStatus,
} from '@/preview/vendor/shared';
import { DocMarkdown } from '@/components/spec/DocMarkdown';
import { HoverPopover } from '@/preview/ui/hover-popover';
import { alignSections, buildAnchorTargets, splitDocBlocks, stripDocAnchors } from '@/preview/vendor/lib/guard-doc-sections';
import { guardBandClasses, guardStatusMeta } from '@/preview/vendor/lib/guard-status';
import { guardStatusWord } from '@/preview/vendor/lib/guard-flow-status';

/** How a status filter treats the non-matching sections. */
export type CoverageFilterMode = 'blur' | 'hide';

/** The red/green split of a MIXED section, some flows failing, some passing. */
interface SectionMix {
  failed: number;
  succeeded: number;
  total: number;
}

/** A section with both failing and succeeding flows, from its per-flow statuses. */
function sectionMix(flows: readonly { status: GuardSectionCoverageStatus }[] | undefined): SectionMix | null {
  if (!flows || flows.length < 2) return null;
  let failed = 0;
  let succeeded = 0;
  for (const f of flows) {
    const plain = guardCoveragePlainStatus(f.status);
    if (plain === 'failed') failed++;
    else if (plain === 'succeeded') succeeded++;
  }
  return failed > 0 && succeeded > 0 ? { failed, succeeded, total: flows.length } : null;
}

/** A section's hover: its coverage word, then the reason (a mix: the composition). */
function reasonText(
  status: GuardSectionCoverageStatus,
  reason: string | undefined,
  mix: SectionMix | null,
): string {
  const word = guardStatusWord(status);
  if (mix) return `${word}: ${mix.failed} of ${mix.total} flows failing, ${mix.succeeded} passing`;
  return reason ? `${word}: ${reason}` : word;
}

/** A mixed section's corner indicator, replaces the dot; sized by real proportions. */
function MixBar({ mix }: { mix: SectionMix }) {
  const pct = Math.round((mix.failed / (mix.failed + mix.succeeded)) * 100);
  return (
    <span
      data-testid="section-mix"
      className="flex h-2.5 w-10 overflow-hidden rounded-full ring-2 ring-background"
    >
      <span className="bg-red-500" style={{ width: `${pct}%` }} />
      <span className="flex-1 bg-emerald-500" />
    </span>
  );
}

import { headingMatchKey as norm } from '@/lib/heading-match';

/** A small "conflict" tag that opens the overlap resolution detail. */
function ConflictTag({ onClick }: { onClick: () => void }) {
  return (
    <HoverPopover portal align="end" content="Flagged spec conflict, click to resolve">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 ring-1 ring-sky-500/30 hover:bg-sky-500/25 dark:text-sky-400"
      >
        <GitMerge className="h-2.5 w-2.5" />
        conflict
      </button>
    </HoverPopover>
  );
}

interface CoverageBlockProps {
  text: string;
  /** Server section anchor (data-anchor), or undefined for a preamble block. */
  anchor: string | undefined;
  status: GuardSectionCoverageStatus | undefined;
  reason: string | undefined;
  /** Present when the section mixes failing and passing flows. */
  mix: SectionMix | null;
  /** The overlap key of a conflict flagging this heading, if any. */
  conflictKey: string | undefined;
  selected: boolean;
  /** Blur mode: dim as a non-match. */
  dimmed: boolean;
  /** Hide mode: collapse out of the DOM as a non-match. */
  hidden: boolean;
  onSelectSection: (anchor: string) => void;
  onOpenConflict?: (key: string) => void;
}

/**
 * One rendered section chunk. Memoized so a selection/filter change elsewhere
 * doesn't re-render (and re-parse) it; the parsed markdown itself is memoized on
 * the chunk text, so even a chunk whose selection toggles reuses its parse.
 */
const CoverageBlock = memo(function CoverageBlock({
  text,
  anchor,
  status,
  reason,
  mix,
  conflictKey,
  selected,
  dimmed,
  hidden,
  onSelectSection,
  onOpenConflict,
}: CoverageBlockProps) {
  // Parse once per chunk text, reused across selection/filter re-renders.
  const md = useMemo(() => <DocMarkdown source={stripDocAnchors(text)} />, [text]);
  if (hidden) return null;

  // Every SECTION carries a status now (claim-keyed coverage always has an answer),
  // so the only unstatused block is a preamble chunk that is no section at all.
  const statused = status != null;
  // Preamble / unmarked-and-unconflicted sections render plain.
  if (!statused && !conflictKey) {
    return (
      <div
        data-anchor={anchor}
        data-status={status}
        className={dimmed ? 'opacity-40 transition-opacity' : undefined}
      >
        {md}
      </div>
    );
  }

  const meta = statused ? guardStatusMeta(status) : null;
  // A conflicted preamble block has no section detail to open, so clicking its
  // body opens the conflict; a real section opens its own detail.
  const onBodyClick = statused
    ? () => onSelectSection(anchor!)
    : conflictKey && onOpenConflict
      ? () => onOpenConflict(conflictKey)
      : undefined;
  return (
    <div
      data-anchor={statused ? anchor : undefined}
      data-status={statused ? status : undefined}
      data-conflict={conflictKey}
      onClick={onBodyClick}
      className={`group relative -mx-2 my-1 scroll-mt-4 rounded px-2 py-1 transition-opacity ${
        onBodyClick ? 'cursor-pointer' : ''
      } ${meta ? guardBandClasses(status!) : ''} ${selected ? 'ring-2 ring-primary/60' : ''} ${
        dimmed ? 'opacity-40' : ''
      }`}
    >
      <span className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
        {conflictKey && onOpenConflict && <ConflictTag onClick={() => onOpenConflict(conflictKey)} />}
        {meta && (
          <HoverPopover portal width="narrow" align="end" content={reasonText(status!, reason, mix)}>
            {mix ? (
              <MixBar mix={mix} />
            ) : (
              <span className={`block h-2.5 w-2.5 rounded-full ring-2 ring-background ${meta.dot}`} />
            )}
          </HoverPopover>
        )}
      </span>
      {md}
    </div>
  );
});

export function GuardDocCoverage({
  content,
  coverage,
  activeFilter,
  filterMode = 'blur',
  selectedAnchor,
  onSelectSection,
  conflictHeadings,
  activeConflictKey = null,
  onOpenConflict,
}: {
  content: string;
  coverage: GuardDocCoverageData;
  /** The five-word coverage status the strip narrowed to, or null for everything. */
  activeFilter: GuardCoveragePlainStatus | null;
  /** Blur (dim in place) vs hide (collapse) the sections a filter excludes. */
  filterMode?: CoverageFilterMode;
  selectedAnchor: string | null;
  onSelectSection: (anchor: string) => void;
  /** Normalized heading text → the overlap key of the conflict flagging it. */
  conflictHeadings?: Map<string, string>;
  /** The open conflict's key, its heading scrolls into view when set. */
  activeConflictKey?: string | null;
  /** Open a conflict's resolution detail (from a conflict tag). */
  onOpenConflict?: (key: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const blocks = useMemo(() => splitDocBlocks(content), [content]);
  const aligned = useMemo(() => alignSections(blocks, coverage.sections), [blocks, coverage.sections]);
  // `#anchor` target → the section a click on it should select+scroll to.
  const anchorTargets = useMemo(() => buildAnchorTargets(blocks, aligned), [blocks, aligned]);
  const conflictOf = (heading: string): string | undefined =>
    heading ? conflictHeadings?.get(norm(heading)) : undefined;

  // Bring the selected section (or the active conflict's heading, or the first
  // filter match) into view.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let sel: Element | null = null;
    if (selectedAnchor) {
      sel = root.querySelector(`[data-anchor="${CSS.escape(selectedAnchor)}"]`);
    } else if (activeConflictKey) {
      sel = root.querySelector(`[data-conflict="${CSS.escape(activeConflictKey)}"]`);
    } else if (activeFilter) {
      const anchor = coverage.sections.find(
        (s) => guardCoveragePlainStatus(s.status) === activeFilter,
      )?.anchor;
      if (anchor) sel = root.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
    }
    // Optional call: jsdom doesn't implement scrollIntoView in every version.
    sel?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [selectedAnchor, activeConflictKey, activeFilter, coverage.sections]);

  // Intercept clicks on rendered links (capture phase). A link click resolves the
  // link, it never also selects the enclosing section (stopPropagation keeps the
  // section body-click from firing). An in-document `#anchor` selects + scrolls the
  // target section instead of opening a new tab; an unresolvable hash no-ops (still
  // no broken tab). External http(s) / relative-doc links fall through to their own
  // new tab (DocMarkdown's target=_blank).
  const onClickCapture = useCallback(
    (e: React.MouseEvent) => {
      const link = (e.target as HTMLElement).closest?.('a');
      if (!link) return;
      e.stopPropagation();
      const href = link.getAttribute('href') ?? '';
      if (!href.startsWith('#')) return;
      e.preventDefault();
      const id = decodeURIComponent(href.slice(1)).toLowerCase();
      const target = anchorTargets.get(id);
      if (target) onSelectSection(target);
    },
    [anchorTargets, onSelectSection],
  );

  if (!coverage.markdown) {
    // Non-markdown doc, one whole-document section; render it verbatim.
    const only = coverage.sections[0];
    return (
      <div ref={scrollRef} className="h-full overflow-auto px-4 py-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
          {content}
        </pre>
        {only ? <div className="sr-only" data-anchor={only.anchor} data-status={only.status} /> : null}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onClickCapture={onClickCapture}
      className="h-full overflow-auto px-4 py-3 text-[13px] leading-relaxed text-foreground"
    >
      {blocks.map((block, i) => {
        const section = aligned[i];
        const status = section?.status;
        const conflictKey = conflictOf(block.headingText);
        const statused = section != null;
        const isSelected = section != null && selectedAnchor === section.anchor;
        // The ring marks only statused sections (matches the click-to-open target).
        const selected = statused && isSelected;
        // The selected section and the open conflict's section always stay
        // visible, so a click/deep-link lands even when it doesn't match the
        // filter (reveal the target rather than clear the user's filter).
        const forceVisible = isSelected || (conflictKey != null && conflictKey === activeConflictKey);
        const matches =
          activeFilter == null || (status != null && guardCoveragePlainStatus(status) === activeFilter);
        const dimmed = filterMode === 'blur' && !matches && !forceVisible;
        const hidden = filterMode === 'hide' && !matches && !forceVisible;
        return (
          <CoverageBlock
            key={i}
            text={block.text}
            anchor={section?.anchor}
            status={status}
            reason={section?.reason}
            mix={sectionMix(section?.flows)}
            conflictKey={conflictKey}
            selected={selected}
            dimmed={dimmed}
            hidden={hidden}
            onSelectSection={onSelectSection}
            onOpenConflict={onOpenConflict}
          />
        );
      })}
    </div>
  );
}
