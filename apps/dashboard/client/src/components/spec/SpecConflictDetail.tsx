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
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { SpecConflict, SpecResolution } from '@/lib/api';
import { useSpec } from './SpecContext';

interface SpecConflictDetailProps {
  conflictId: string;
  onClose?: () => void;
}

export function SpecConflictDetail({ conflictId, onClose }: SpecConflictDetailProps) {
  const { scan, busyConflictId, resolveConflict } = useSpec();
  const conflict = scan?.openConflicts.find((c) => c.id === conflictId);
  const isVersionChain = !!conflict?.candidates[0]?.claim.id.startsWith('version-chain:');

  // Selected candidate within this conflict. Default = recommended.
  const [selectedIndex, setSelectedIndex] = useState<number>(
    conflict?.defaultPick ?? 0,
  );
  // Reset selection whenever the user navigates to a different conflict.
  useEffect(() => {
    setSelectedIndex(conflict?.defaultPick ?? 0);
  }, [conflict?.id, conflict?.defaultPick]);

  // Auto-clear if this conflict disappears from the open list (user
  // resolved it).
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

  return (
    <div className="flex h-full flex-col bg-background">
      <DetailHeader conflict={conflict} isVersionChain={isVersionChain} onClose={onClose} />
      <div className="flex flex-1 min-h-0">
        <CandidateSidebar
          conflict={conflict}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          isVersionChain={isVersionChain}
        />
        <div className="flex flex-1 min-w-0 flex-col">
          <div className="flex-1 overflow-auto px-6 py-4">
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
        isVersionChain={isVersionChain}
        isDefault={isDefault}
        busy={busy}
        customMode={customMode}
        onPick={onPick}
        onKeepAll={onKeepAll}
        onOpenCustom={() => setCustomMode(true)}
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
  onClose,
}: {
  conflict: SpecConflict;
  isVersionChain: boolean;
  onClose?: () => void;
}) {
  const label = isVersionChain
    ? conflict.subject.replace(/^version chain:\s*/, '')
    : conflict.subject;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-6 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {isVersionChain ? (
          <GitBranch className="h-5 w-5 shrink-0 text-amber-400" />
        ) : (
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div className="flex items-center gap-1">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
              isVersionChain ? 'bg-amber-500/15 text-amber-300' : 'bg-muted text-muted-foreground'
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
          className="inline-flex items-center justify-center rounded p-0.5 text-amber-300/80 hover:text-amber-200 hover:bg-amber-500/10 transition-colors"
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
            <div className="flex w-full items-center gap-1 text-[10px]">
              <span className="rounded bg-muted px-1 py-0.5 uppercase tracking-wider text-muted-foreground">
                {role}
              </span>
              {docKind && docKind !== 'unknown' && (
                <span className="rounded bg-muted px-1 py-0.5 uppercase tracking-wider text-muted-foreground">
                  {docKind}
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
  return <ContentCandidate candidate={candidate} isDefault={isDefault} />;
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
    subjects?: string[];
  } | undefined;
  const file = content?.file ?? candidate.claim.provenance.file;
  const claimCount = content?.claimCount ?? 0;
  const topics = content?.topics ?? {};
  const subjects = content?.subjects ?? [];
  const lastTouched = candidate.claim.metadata.lastTouched;
  const docKind = candidate.claim.metadata.docKind;
  const role =
    candidate.index === 0
      ? 'older version'
      : candidate.index === conflict.candidates.length - 1
        ? 'current version'
        : 'middle version';
  return (
    <div className="mx-auto max-w-4xl">
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
      {subjects.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Subjects this doc covers · {subjects.length}
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 rounded border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
            {subjects.map((s) => (
              <li key={s} className="font-mono">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      <DocPreview source={candidate.claim.provenance.quote} />
    </div>
  );
}

function ContentCandidate({
  candidate,
  isDefault,
}: {
  candidate: SpecConflict['candidates'][number];
  isDefault: boolean;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <CandidateHeading
        file={`${candidate.claim.provenance.file}:${candidate.claim.provenance.line}`}
        role={candidate.weight}
        docKind={candidate.claim.metadata.docKind}
        isDefault={isDefault}
      />
      <DocPreview source={candidate.claim.provenance.quote} />
      {candidate.claim.content !== undefined && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Structured content
          </div>
          <pre className="max-h-60 overflow-auto rounded border border-border bg-muted/20 p-3 font-mono text-[11px] text-muted-foreground">
            {JSON.stringify(candidate.claim.content, null, 2)}
          </pre>
        </div>
      )}
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

const DOC_PREVIEW_COLLAPSED_LINES = 10;

function DocPreview({ source }: { source: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = (source ?? '').split('\n');
  const hasMore = lines.length > DOC_PREVIEW_COLLAPSED_LINES;
  const displayed = expanded ? source : lines.slice(0, DOC_PREVIEW_COLLAPSED_LINES).join('\n');
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Doc preview
      </div>
      <div
        className={`overflow-auto rounded border border-border bg-muted/30 p-3 text-xs text-muted-foreground ${
          expanded ? 'max-h-[32rem]' : ''
        }`}
      >
        <MarkdownPreview source={displayed} />
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[11px] text-primary hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action footer
// ---------------------------------------------------------------------------

function ActionFooter({
  conflict,
  isVersionChain,
  isDefault,
  busy,
  customMode,
  onPick,
  onKeepAll,
  onOpenCustom,
}: {
  conflict: SpecConflict;
  isVersionChain: boolean;
  isDefault: boolean;
  busy: boolean;
  customMode: boolean;
  onPick: () => void;
  onKeepAll: () => void;
  onOpenCustom: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-card px-6 py-3">
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
          <Button size="sm" variant="outline" onClick={onOpenCustom} disabled={busy}>
            Write custom answer
          </Button>
        )
      )}
      <Button size="sm" onClick={onPick} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="mr-2 h-3.5 w-3.5" />
        )}
        {isVersionChain ? 'Use this version' : 'Pick this candidate'}
        {isDefault && <span className="ml-1.5 text-[10px] opacity-70">(recommended)</span>}
      </Button>
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

