/**
 * Detail view for a single Spec conflict. Three levels of navigation:
 *
 *   Sidebar list (conflicts) → Candidate strip (this pane, top) → Selected candidate detail (this pane, body)
 *
 * One candidate is rendered at a time. Switching candidates is a
 * single click on the strip. Action buttons (Pick / Keep all docs /
 * Custom answer) live in a footer so they're always visible.
 */

import { useEffect, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  GitBranch,
  Info,
  FileText,
  X,
  Check,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/components/ui/hover-popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { SpecConflict, SpecDecision, SpecResolution } from '@/lib/api';
import { useSpec } from './SpecContext';

interface SpecConflictDetailProps {
  conflictId: string;
  onClose?: () => void;
}

export function SpecConflictDetail({ conflictId, onClose }: SpecConflictDetailProps) {
  const { scan, busyConflictId, resolveConflict, revokeDecision, markSuperseded } = useSpec();
  // Look in both lists — the detail view is rendered from the Spec tab
  // (where conflicts come from `openConflicts`) and from the Decisions
  // tab (where they come from `decidedConflicts`).
  const openMatch = scan?.openConflicts.find((c) => c.id === conflictId);
  const decidedMatch = scan?.decidedConflicts.find(
    (d) => d.conflict.id === conflictId,
  );
  const conflict = openMatch ?? decidedMatch?.conflict;
  const decision: SpecDecision | undefined = decidedMatch?.decision;
  const isDecided = !!decision;
  const isVersionChain = !!conflict?.candidates[0]?.claim.id.startsWith('version-chain:');

  // Selected candidate within this conflict. For decided conflicts,
  // open on the candidate the user picked (if any) so they can see
  // exactly what's currently committed. Otherwise, open on the
  // engine's recommended pick.
  const initialIndex =
    decision?.resolution.kind === 'pick'
      ? decision.resolution.candidateIndex
      : (conflict?.defaultPick ?? 0);
  const [selectedIndex, setSelectedIndex] = useState<number>(initialIndex);
  useEffect(() => {
    setSelectedIndex(initialIndex);
    // Intentional: only reset when navigating to a different conflict.
  }, [conflict?.id]);

  // Auto-clear if the conflict disappears from both lists (e.g. the
  // doc was removed and a rescan dropped it entirely).
  useEffect(() => {
    if (scan && !conflict && onClose) onClose();
  }, [scan, conflict, onClose]);

  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  // Drop custom mode when switching conflicts.
  useEffect(() => {
    setCustomMode(false);
    setCustomText('');
  }, [conflict?.id]);

  if (!conflict) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <AlertCircle className="h-6 w-6" />
        <span>Conflict not found. It may have been resolved.</span>
      </div>
    );
  }

  const busy = busyConflictId === conflict.id;
  const selected = conflict.candidates[selectedIndex] ?? conflict.candidates[0];
  const isDefault = selectedIndex === conflict.defaultPick;

  const onPick = () =>
    resolveConflict(conflict, { kind: 'pick', candidateIndex: selectedIndex });
  const onKeepAll = () =>
    resolveConflict(conflict, { kind: 'custom', content: 'merge-both' });
  const onSaveCustom = () =>
    resolveConflict(conflict, { kind: 'custom', content: customText.trim() });

  const onRevoke = () => revokeDecision(conflict.id);

  return (
    <div className="flex h-full flex-col bg-background">
      <DetailHeader
        conflict={conflict}
        isVersionChain={isVersionChain}
        decision={decision}
        onClose={onClose}
      />
      <div className="flex flex-1 min-h-0">
        <CandidateSidebar
          conflict={conflict}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          isVersionChain={isVersionChain}
        />
        <div className="flex flex-1 min-w-0 flex-col">
          <div className="flex-1 overflow-auto px-5 py-3">
            <CandidateDetail
              candidate={selected}
              conflict={conflict}
              isVersionChain={isVersionChain}
              isDefault={isDefault}
            />
            {customMode && (
              <div className="mt-4 rounded border border-dashed border-border p-3">
                <textarea
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="Enter the authoritative answer in your own words…"
                  className="w-full resize-none rounded border border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  rows={5}
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCustomMode(false);
                      setCustomText('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" disabled={busy || !customText.trim()} onClick={onSaveCustom}>
                    Save custom answer
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <ActionFooter
        conflict={conflict}
        selectedIndex={selectedIndex}
        isVersionChain={isVersionChain}
        isDefault={isDefault}
        isDecided={isDecided}
        busy={busy}
        customMode={customMode}
        onPick={onPick}
        onMarkSuperseded={markSuperseded}
        onKeepAll={onKeepAll}
        onOpenCustom={() => setCustomMode(true)}
        onRevoke={onRevoke}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function DetailHeader({
  conflict,
  isVersionChain,
  decision,
  onClose,
}: {
  conflict: SpecConflict;
  isVersionChain: boolean;
  decision?: SpecDecision;
  onClose?: () => void;
}) {
  const label = isVersionChain
    ? conflict.subject.replace(/^version chain:\s*/, '')
    : conflict.subject;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {isVersionChain ? (
          <GitBranch className="h-5 w-5 shrink-0 text-amber-400" />
        ) : (
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div className="flex items-center gap-1">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
              isVersionChain ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground'
            }`}
          >
            {isVersionChain ? 'version chain' : conflict.topic}
          </span>
          {isVersionChain && <VersionChainInfoButton conflict={conflict} />}
        </div>
        <h2 className="truncate text-base font-semibold">{label}</h2>
        <span className="ml-2 shrink-0 text-xs text-muted-foreground">
          {conflict.candidates.length} candidates
        </span>
        {decision && (
          <span
            className="ml-2 shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300"
            title={`Decided ${new Date(decision.resolvedAt).toLocaleString()}`}
          >
            decided
          </span>
        )}
      </div>
      {onClose && (
        <Button size="sm" variant="ghost" onClick={onClose} title="Close detail view">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function VersionChainInfoButton({ conflict }: { conflict: SpecConflict }) {
  const detectedFrom = (conflict.candidates[0]?.claim.content as { detectedFrom?: string } | undefined)?.detectedFrom;
  const detection =
    detectedFrom === 'filename'
      ? 'filenames follow a v1/v2 pattern'
      : detectedFrom === 'llm'
        ? 'the LLM judged one doc to be a successor of the other based on content (no filename versioning was present)'
        : 'a versioning relationship was detected';
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          className="inline-flex items-center justify-center rounded p-0.5 text-amber-700/80 hover:text-amber-900 dark:text-amber-300/80 dark:hover:text-amber-200 hover:bg-amber-500/10 transition-colors"
          aria-label="About version chain conflicts"
        >
          <Info className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-sm whitespace-normal text-left leading-relaxed">
          <p>
            These docs describe overlapping specs and {detection}. Pick which doc
            is the current source of truth — claims from the others get dropped.
            Or keep all docs to merge them as independent sources.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Candidate sub-sidebar — vertical list to the left of the detail
// ---------------------------------------------------------------------------

function CandidateSidebar({
  conflict,
  selectedIndex,
  onSelect,
  isVersionChain,
}: {
  conflict: SpecConflict;
  selectedIndex: number;
  onSelect: (i: number) => void;
  isVersionChain: boolean;
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card/40 p-2">
      <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Candidates · {conflict.candidates.length}
      </div>
      {conflict.candidates.map((cand, i) => {
        const isSelected = i === selectedIndex;
        const isDefault = i === conflict.defaultPick;
        const role = isVersionChain
          ? i === 0
            ? 'older'
            : i === conflict.candidates.length - 1
              ? 'current'
              : 'middle'
          : cand.weight;
        const content = cand.claim.content as {
          file?: string;
          claimCount?: number;
        } | undefined;
        const file = content?.file ?? cand.claim.provenance.file;
        const basename = file.split('/').pop() ?? file;
        const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
        const stat = isVersionChain
          ? content?.claimCount != null
            ? `${content.claimCount} claims`
            : null
          : `:${cand.claim.provenance.line}`;
        const docKind = cand.claim.metadata.docKind;
        const claimStatus = cand.claim.metadata.status;
        const claimKind = cand.claim.kind;
        return (
          <button
            key={cand.index}
            type="button"
            onClick={() => onSelect(i)}
            title={file}
            className={`flex flex-col items-start gap-1 rounded border px-2.5 py-2 text-left text-xs transition-colors ${
              isSelected
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            }`}
          >
            <div className="flex w-full items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-mono">{basename}</span>
              {isDefault && (
                <Check
                  className="h-3 w-3 shrink-0 text-primary"
                  aria-label="recommended"
                />
              )}
            </div>
            {dir && (
              <div className="w-full truncate font-mono text-[10px] text-muted-foreground/70">
                {dir}/
              </div>
            )}
            <div className="flex w-full flex-wrap items-center gap-1 text-[10px]">
              <span className="rounded bg-muted px-1 py-0.5 uppercase tracking-wider text-muted-foreground">
                {role}
              </span>
              {docKind && docKind !== 'unknown' && (
                <span className="rounded bg-muted px-1 py-0.5 uppercase tracking-wider text-muted-foreground">
                  {docKind}
                </span>
              )}
              {claimStatus && claimStatus !== 'shipped' && (
                <span
                  className={`rounded px-1 py-0.5 uppercase tracking-wider ${
                    claimStatus === 'deferred' ||
                    claimStatus === 'out-of-scope' ||
                    claimStatus === 'deprecated'
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : 'bg-muted text-muted-foreground'
                  }`}
                  title={`Lifecycle status: ${claimStatus}`}
                >
                  {claimStatus}
                </span>
              )}
              {claimKind === 'constraint' && (
                <span
                  className="rounded bg-sky-500/15 px-1 py-0.5 uppercase tracking-wider text-sky-700 dark:text-sky-300"
                  title="This claim narrows the subject (e.g. adding 403 responses to existing endpoints) rather than defining it from scratch."
                >
                  constraint
                </span>
              )}
              {stat && <span className="ml-auto text-muted-foreground">{stat}</span>}
            </div>
          </button>
        );
      })}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Candidate detail body
// ---------------------------------------------------------------------------

function CandidateDetail({
  candidate,
  conflict,
  isVersionChain,
  isDefault,
}: {
  candidate: SpecConflict['candidates'][number];
  conflict: SpecConflict;
  isVersionChain: boolean;
  isDefault: boolean;
}) {
  if (isVersionChain) {
    return <VersionChainCandidate candidate={candidate} conflict={conflict} isDefault={isDefault} />;
  }
  return <ContentCandidate candidate={candidate} conflict={conflict} isDefault={isDefault} />;
}

function VersionChainCandidate({
  candidate,
  conflict,
  isDefault,
}: {
  candidate: SpecConflict['candidates'][number];
  conflict: SpecConflict;
  isDefault: boolean;
}) {
  const content = candidate.claim.content as {
    file?: string;
    claimCount?: number;
    topics?: Record<string, number>;
  } | undefined;
  const file = content?.file ?? candidate.claim.provenance.file;
  const claimCount = content?.claimCount ?? 0;
  const topics = content?.topics ?? {};
  const lastTouched = candidate.claim.metadata.lastTouched;
  const docKind = candidate.claim.metadata.docKind;
  const role =
    candidate.index === 0
      ? 'older version'
      : candidate.index === conflict.candidates.length - 1
        ? 'current version'
        : 'middle version';
  return (
    <div>
      <CandidateHeading
        file={file}
        role={role}
        docKind={docKind}
        isDefault={isDefault}
        meta={
          <>
            <span>
              <span className="font-medium text-foreground">{claimCount}</span> claims extracted
            </span>
            <span>
              Last touched <span className="text-foreground">{formatRelativeTime(lastTouched)}</span>
            </span>
          </>
        }
      />
      {Object.keys(topics).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(topics)
            .sort((a, b) => b[1] - a[1])
            .map(([t, count]) => (
              <span key={t} className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {t} <span className="text-foreground">{count}</span>
              </span>
            ))}
        </div>
      )}
      <ResolverSuggestion candidate={candidate} conflict={conflict} />
      {conflict.explanation && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            What differs
          </div>
          <div className="rounded border border-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground">
            {conflict.explanation}
          </div>
        </div>
      )}
      <DocPreview source={candidate.claim.provenance.quote} />
    </div>
  );
}

function ContentCandidate({
  candidate,
  conflict,
  isDefault,
}: {
  candidate: SpecConflict['candidates'][number];
  conflict: SpecConflict;
  isDefault: boolean;
}) {
  return (
    <div>
      <CandidateHeading
        file={`${candidate.claim.provenance.file}:${candidate.claim.provenance.line}`}
        role={candidate.weight}
        docKind={candidate.claim.metadata.docKind}
        isDefault={isDefault}
      />
      {isDefault && (
        <div className="mt-2 rounded border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-primary">Recommended by engine.</span>{' '}
          {recommendationReason(candidate, conflict)}
        </div>
      )}
      <ResolverSuggestion candidate={candidate} conflict={conflict} />
      {conflict.explanation && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            What differs
          </div>
          <div className="rounded border border-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground">
            {conflict.explanation}
          </div>
        </div>
      )}
      <DocPreview source={candidate.claim.provenance.quote} />
    </div>
  );
}

/**
 * Why the engine picked this candidate by default. Mirrors the
 * priority order in buildConflict's default-pick rule: docKind authority
 * > lastTouched > content richness.
 */
function recommendationReason(
  candidate: SpecConflict['candidates'][number],
  conflict: SpecConflict,
): string {
  const reasons: string[] = [];
  const docKind = candidate.claim.metadata.docKind;
  const others = conflict.candidates.filter((c) => c.index !== candidate.index);
  const otherKinds = new Set(others.map((c) => c.claim.metadata.docKind));
  // Higher authority than all others → "more authoritative doc kind"
  if (docKind && docKind !== 'unknown') {
    const beats = [...otherKinds].filter((k) => kindRank(docKind) > kindRank(k));
    if (beats.length > 0) {
      reasons.push(`higher-authority doc kind (${docKind} beats ${beats.join(', ')})`);
    }
  }
  // Newest by lastTouched
  const allTouched = conflict.candidates.map((c) => c.claim.metadata.lastTouched);
  const newest = allTouched.reduce((a, b) => (a > b ? a : b));
  if (candidate.claim.metadata.lastTouched === newest) {
    reasons.push('newest source');
  }
  // Richest content
  const myRichness = contentRichness(candidate.claim.content);
  const maxRichness = Math.max(...conflict.candidates.map((c) => contentRichness(c.claim.content)));
  if (myRichness === maxRichness && myRichness > 0) {
    reasons.push('most structurally complete');
  }
  return reasons.length > 0 ? reasons.join(' · ') : 'no other candidate ranks higher';
}

function kindRank(kind: string): number {
  if (kind === 'adr' || kind === 'rfc') return 4;
  if (kind === 'prd' || kind === 'spec') return 3;
  if (kind === 'design-note' || kind === 'runbook') return 2;
  if (kind === 'readme') return 1;
  return 0;
}

function contentRichness(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value !== 'object') return 1;
  if (Array.isArray(value)) {
    return (value as unknown[]).reduce<number>((acc, v) => acc + contentRichness(v), 0);
  }
  let total = 0;
  for (const v of Object.values(value as Record<string, unknown>)) total += contentRichness(v);
  return total;
}

/**
 * Violet callout shown on the candidate the LLM resolver suggested.
 * Only renders when this candidate's index matches
 * `conflict.resolverVerdict.pick`. High-confidence verdicts auto-apply
 * and never reach an open conflict, so this only ever shows medium/low.
 */
function ResolverSuggestion({
  candidate,
  conflict,
}: {
  candidate: SpecConflict['candidates'][number];
  conflict: SpecConflict;
}) {
  const verdict = conflict.resolverVerdict;
  if (!verdict || verdict.pick !== candidate.index) return null;
  return (
    <div className="mt-2 rounded border border-violet-500/30 bg-violet-500/5 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-violet-700 dark:text-violet-300">
        Resolver suggests
      </span>
      <span className="ml-1.5 rounded bg-violet-500/15 px-1 py-0.5 text-[10px] uppercase tracking-wider text-violet-700 dark:text-violet-300">
        {verdict.confidence}
      </span>
      <span className="ml-1.5">— {verdict.reasoning}</span>
    </div>
  );
}

function CandidateHeading({
  file,
  role,
  docKind,
  isDefault,
  meta,
}: {
  file: string;
  role: string;
  docKind?: string;
  isDefault: boolean;
  meta?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-foreground">{file}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {role}
        </span>
        {docKind && docKind !== 'unknown' && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {docKind}
          </span>
        )}
        {isDefault && (
          <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
            recommended
          </span>
        )}
      </div>
      {meta && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {meta}
        </div>
      )}
    </div>
  );
}

function DocPreview({ source }: { source: string }) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Doc preview
      </div>
      <div className="rounded border border-border bg-muted/30 p-3 text-sm leading-relaxed text-muted-foreground">
        <MarkdownPreview source={source} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action footer
// ---------------------------------------------------------------------------

function ActionFooter({
  conflict,
  selectedIndex,
  isVersionChain,
  isDefault,
  isDecided,
  busy,
  customMode,
  onPick,
  onKeepAll,
  onOpenCustom,
  onRevoke,
  onMarkSuperseded,
}: {
  conflict: SpecConflict;
  selectedIndex: number;
  isVersionChain: boolean;
  isDefault: boolean;
  isDecided: boolean;
  busy: boolean;
  customMode: boolean;
  onPick: () => void;
  onKeepAll: () => void;
  onOpenCustom: () => void;
  onRevoke: () => void;
  onMarkSuperseded: (older: string, newer: string) => Promise<void>;
}) {
  const [pickingTarget, setPickingTarget] = useState(false);

  // Build supersede targets — files in this conflict that differ from
  // the currently-selected candidate's file. Hidden if no valid target
  // (e.g. all candidates from same source file).
  const selected = conflict.candidates[selectedIndex];
  const selectedFile = selected?.claim.provenance.file ?? '';
  const seenFiles = new Set<string>([selectedFile]);
  const targets: Array<{ file: string; weight: SpecConflict['candidates'][number]['weight'] }> = [];
  if (selected) {
    for (const c of conflict.candidates) {
      const f = c.claim.provenance.file;
      if (seenFiles.has(f)) continue;
      seenFiles.add(f);
      targets.push({ file: f, weight: c.weight });
    }
  }
  const supersedeEligible = !isVersionChain && !isDecided && targets.length > 0;

  return (
    <div className="relative flex shrink-0 items-center gap-2 border-t border-border bg-card px-5 py-3">
      {isDecided && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onRevoke}
          disabled={busy}
          className="text-destructive hover:text-destructive"
          title="Revoke this decision — the conflict will re-open"
        >
          Revoke decision
        </Button>
      )}
      <div className="ml-auto flex items-center gap-2">
        {isVersionChain ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onKeepAll}
            disabled={busy}
            title="Keep all docs — claims from every version flow through unfiltered"
          >
            Keep all docs
          </Button>
        ) : (
          !customMode && (
            <>
              {supersedeEligible && (
                <HoverPopover
                  side="top"
                  align="end"
                  width="wide"
                  content={
                    <>
                      Mark <span className="font-mono">{selectedFile}</span> as an older version of one of the other docs in this conflict. Claims from this doc are dropped from the corpus and every conflict caused by the same supersession clears in one action.
                    </>
                  }
                >
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPickingTarget((v) => !v)}
                    disabled={busy}
                  >
                    Mark superseded by →
                  </Button>
                </HoverPopover>
              )}
              <Button size="sm" variant="outline" onClick={onOpenCustom} disabled={busy}>
                Write custom answer
              </Button>
            </>
          )
        )}
        <Button size="sm" onClick={onPick} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-2 h-3.5 w-3.5" />
          )}
          {isDecided
            ? isVersionChain
              ? 'Use this version instead'
              : 'Change to this candidate'
            : isVersionChain
              ? 'Use this version'
              : 'Pick this candidate'}
          {!isDecided && isDefault && (
            <span className="ml-1.5 text-[10px] opacity-70">(recommended)</span>
          )}
        </Button>
      </div>
      {pickingTarget && supersedeEligible && (
        <div className="absolute bottom-full right-6 mb-2 w-[min(28rem,90vw)] rounded border border-border bg-popover p-3 shadow-lg">
          <div className="mb-2 text-[11px] text-muted-foreground">
            Mark <span className="font-mono text-foreground">{selectedFile}</span> as superseded by:
          </div>
          <ul className="flex flex-col gap-1">
            {targets.map((t) => (
              <li key={t.file}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setPickingTarget(false);
                    await onMarkSuperseded(selectedFile, t.file);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5 text-left text-xs hover:border-primary hover:bg-primary/5"
                >
                  <span className="truncate font-mono">{t.file}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t.weight}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setPickingTarget(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <span className="sr-only">
        {conflict.candidates.length} candidates total
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function MarkdownPreview({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <div className="mb-1 text-sm font-semibold text-foreground">{children}</div>,
        h2: ({ children }) => <div className="mb-1 text-sm font-semibold text-foreground">{children}</div>,
        h3: ({ children }) => <div className="mb-1 text-xs font-semibold text-foreground">{children}</div>,
        h4: ({ children }) => <div className="mb-1 text-xs font-semibold text-foreground">{children}</div>,
        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-1 list-disc pl-4 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-1 list-decimal pl-4 last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        code: ({ children }) => (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>
        ),
        pre: ({ children }) => (
          <pre className="my-1 overflow-auto rounded bg-muted p-2 font-mono text-[11px] text-foreground">{children}</pre>
        ),
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-1 border-l-2 border-border pl-2 italic">{children}</blockquote>
        ),
        // GFM tables — without these renderers the table still parses
        // but inherits no styling and renders as a wall of plain rows.
        table: ({ children }) => (
          <div className="my-1.5 overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b border-border bg-muted/40">{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => <tr className="border-b border-border/40 last:border-0">{children}</tr>,
        th: ({ children }) => (
          <th className="px-2 py-1 text-left font-semibold text-foreground">{children}</th>
        ),
        td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

