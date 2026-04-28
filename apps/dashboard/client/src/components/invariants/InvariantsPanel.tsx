import { Loader2, Sparkles } from 'lucide-react';
import type { InvariantResponse, InvariantDraftResponse } from '@/lib/api';
import type { InvariantsRunState } from '@/hooks/useInvariants';

export type SelectedInvariant =
  | { kind: 'draft'; id: string }
  | { kind: 'active'; slug: string };

type InvariantsPanelProps = {
  active: InvariantResponse[];
  drafts: InvariantDraftResponse[];
  isLoading: boolean;
  error: string | null;
  run: InvariantsRunState;
  selected: SelectedInvariant | null;
  onTrigger: (mode: 'full' | 'diff') => Promise<void>;
  onSelectDraft: (draftId: string) => void;
  onSelectActive: (slug: string) => void;
};

function formatProgress(run: InvariantsRunState): string | null {
  if (run.status !== 'running') return null;
  if (!run.lastEvent) return 'Starting…';
  const e = run.lastEvent;
  switch (e.kind) {
    case 'start':
      return `Starting (${e.mode})…`;
    case 'spec-loaded':
      return e.empty ? 'No spec sources found' : `Spec — ${e.sections} section(s)`;
    case 'files-analyzed':
      return `Analyzed ${e.count} file(s)`;
    case 'plugin-start':
      return `${e.plugin}: starting`;
    case 'plugin-progress':
      return `${e.plugin}: ${e.label} (${e.current}/${e.total})`;
    case 'plugin-end':
      return `${e.plugin}: ${e.drafts} draft(s)`;
    case 'plugin-failed':
      return `${e.plugin}: failed`;
    case 'done':
      return `Done — ${e.drafts} draft(s)`;
  }
}

function slugFromInvariant(inv: InvariantResponse): string | null {
  if (!inv.sourceFile) return null;
  const base = inv.sourceFile.split('/').pop() ?? '';
  return base.replace(/\.ya?ml$/, '') || null;
}

export function InvariantsPanel({
  active,
  drafts,
  isLoading,
  error,
  run,
  selected,
  onTrigger,
  onSelectDraft,
  onSelectActive,
}: InvariantsPanelProps) {
  const isRunning = run.status === 'running';
  const progressMessage = formatProgress(run);

  return (
    <div className="flex h-full flex-col">
      {/* Suggest CTA */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => onTrigger('full')}
          disabled={isRunning}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {isRunning ? 'Discovering…' : 'Suggest invariants'}
        </button>
        {progressMessage && (
          <div className="mt-1 truncate text-[10px] text-muted-foreground">{progressMessage}</div>
        )}
        {run.status === 'failed' && (
          <div className="mt-1 truncate text-[10px] text-destructive">
            Discovery failed: {run.error}
          </div>
        )}
        {run.status === 'done' && (
          <div className="mt-1 truncate text-[10px] text-emerald-500">
            Done — {run.drafts} draft(s) added
          </div>
        )}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="p-3 text-xs text-destructive">{error}</div>
      ) : (
        <div className="flex-1 overflow-auto">
          <Section
            title={`Review queue${drafts.length ? ` (${drafts.length})` : ''}`}
            empty={
              drafts.length === 0
                ? 'No drafts. Click "Suggest invariants" above to generate some.'
                : null
            }
          >
            {drafts.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                isActive={selected?.kind === 'draft' && selected.id === draft.id}
                onSelect={() => onSelectDraft(draft.id)}
              />
            ))}
          </Section>

          <Section
            title={`Active${active.length ? ` (${active.length})` : ''}`}
            empty={active.length === 0 ? 'No active invariants yet.' : null}
          >
            {active.map((inv) => {
              const slug = slugFromInvariant(inv);
              return (
                <ActiveRow
                  key={inv.id}
                  invariant={inv}
                  slug={slug}
                  isActive={!!slug && selected?.kind === 'active' && selected.slug === slug}
                  onSelect={() => slug && onSelectActive(slug)}
                />
              );
            })}
          </Section>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section(props: { title: string; empty: string | null; children: React.ReactNode }) {
  const hasContent = Array.isArray(props.children)
    ? (props.children as unknown[]).length > 0
    : props.children != null;
  return (
    <div className="border-b border-border">
      <div className="sticky top-0 z-10 bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {props.title}
      </div>
      {hasContent ? (
        <div className="flex flex-col">{props.children}</div>
      ) : (
        <div className="px-3 py-2 text-xs text-muted-foreground/70">{props.empty}</div>
      )}
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    pct >= 80
      ? 'bg-emerald-500/15 text-emerald-500'
      : pct >= 60
        ? 'bg-amber-500/15 text-amber-500'
        : 'bg-red-500/15 text-red-500';
  return (
    <span className={`rounded px-1 py-px text-[10px] font-medium ${tone}`}>{pct}%</span>
  );
}

function DraftRow({
  draft,
  isActive,
  onSelect,
}: {
  draft: InvariantDraftResponse;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col gap-1 border-b border-border/50 px-3 py-2 text-left hover:bg-muted/30 ${
        isActive ? 'bg-muted/40' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">
          {draft.type}
        </span>
        <ConfidencePill value={draft.confidence} />
      </div>
      <div className="truncate text-sm font-medium text-foreground" title={draft.scope}>
        {draft.scope}
      </div>
      <div
        className="truncate text-[11px] text-muted-foreground"
        title={draft.rationale}
      >
        {draft.rationale}
      </div>
    </button>
  );
}

function ActiveRow({
  invariant,
  slug,
  isActive,
  onSelect,
}: {
  invariant: InvariantResponse;
  slug: string | null;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!slug}
      className={`flex flex-col gap-0.5 border-b border-border/50 px-3 py-2 text-left hover:bg-muted/30 disabled:cursor-not-allowed ${
        isActive ? 'bg-muted/40' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-500">
          {invariant.type}
        </span>
        <span className="text-[10px] text-muted-foreground">v{invariant.pluginVersion}</span>
      </div>
      <div className="truncate text-sm font-medium" title={invariant.scope}>
        {invariant.scope}
      </div>
      {invariant.provenance.signal && (
        <div
          className="truncate text-[11px] text-muted-foreground"
          title={invariant.provenance.signal}
        >
          {invariant.provenance.signal}
        </div>
      )}
    </button>
  );
}
