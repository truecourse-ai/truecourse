/**
 * The Claims tab's LEFT PANEL — the extracted claim corpus in the shape the docs
 * wrote it: one group per DOC, and inside it one group per SECTION (headed by the
 * live heading, falling back to the anchor when the anchor no longer resolves),
 * both headers sticky. Each row is one claim: its title, a coverage dot, and the
 * muted hint of what testing it would take.
 *
 * A doc's REFUSED statements close it out as a final, visibly quieter group: they
 * are not claims and never wear a coverage dot, but they are selectable under
 * their own synthetic id so a reader can read WHY extraction refused them instead
 * of guessing from a list label.
 *
 * Rows are previewable: single-click previews the claim, double-click pins it,
 * and a claim opened from somewhere else (a section's gapped-claim row, a deep
 * link) scrolls its row into view — the cross-navigation rule every panel follows.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { HoverPopover } from '@/components/ui/hover-popover';
import { useScrollToSelected } from '@/hooks/useScrollToSelected';
import {
  GUARD_CLAIM_COVERAGE,
  groupGuardClaims,
  guardClaimNeedsHint,
  type GuardClaimDocGroup,
  type GuardUntestableEntry,
} from '@/lib/guard-claims';
import type { GuardClaimRow } from '@truecourse/shared';

const SELECT =
  'rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
/** The doc header sits at the top; the section header parks directly under it. */
const DOC_HEADER =
  'sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';
const SECTION_HEADER =
  'sticky top-6 z-10 flex items-center justify-between border-b border-border/60 bg-card px-3 py-1 text-[10px] font-medium text-muted-foreground';

function claimsIn(group: GuardClaimDocGroup): number {
  return group.sections.reduce((n, s) => n + s.claims.length, 0);
}

function ClaimRow({
  claim,
  active,
  onOpen,
  setRef,
}: {
  claim: GuardClaimRow;
  active: boolean;
  onOpen: (id: string, pinned: boolean) => void;
  setRef: (el: HTMLButtonElement | null) => void;
}) {
  const meta = GUARD_CLAIM_COVERAGE[claim.coverage];
  return (
    <button
      ref={setRef}
      type="button"
      role="listitem"
      onClick={() => onOpen(claim.id, false)}
      onDoubleClick={() => onOpen(claim.id, true)}
      title={`${claim.title} — click to preview, double-click to pin`}
      className={`flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left transition-colors ${
        active ? 'bg-primary/10' : 'hover:bg-muted/40'
      }`}
    >
      <div className="flex w-full items-start gap-2">
        <HoverPopover portal width="narrow" content={`${meta.label} — ${meta.hint}`}>
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        </HoverPopover>
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">{claim.title}</span>
      </div>
      <span className="w-full truncate pl-4 text-[11px] text-muted-foreground">{guardClaimNeedsHint(claim)}</span>
    </button>
  );
}

function UntestableRow({
  entry,
  active,
  onOpen,
  setRef,
}: {
  entry: GuardUntestableEntry;
  active: boolean;
  onOpen: (id: string, pinned: boolean) => void;
  setRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={setRef}
      type="button"
      role="listitem"
      onClick={() => onOpen(entry.id, false)}
      onDoubleClick={() => onOpen(entry.id, true)}
      title={`${entry.row.text} — click to preview, double-click to pin`}
      className={`flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left transition-colors ${
        active ? 'bg-primary/10' : 'hover:bg-muted/40'
      }`}
    >
      <span className="w-full truncate text-[12px] italic leading-snug text-muted-foreground">{entry.row.text}</span>
      <span className="w-full truncate text-[11px] text-muted-foreground/80">{entry.row.reason}</span>
    </button>
  );
}

export function GuardClaimsPanel({
  claims,
  untestable,
  loading,
  error,
  activeId,
  onOpen,
}: {
  claims: GuardClaimRow[];
  untestable: GuardUntestableEntry[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  onOpen: (id: string, pinned: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const groups = useMemo(() => groupGuardClaims(claims, untestable, search), [claims, untestable, search]);

  // A claim opened from a section's gap row arrives selected but off-screen —
  // bring the row to the user. Same mechanism in every guard panel.
  const rowRefs = useScrollToSelected<HTMLButtonElement>(activeId, [groups]);

  if (loading && claims.length === 0 && untestable.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error && claims.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <span>{error}</span>
      </div>
    );
  }
  if (claims.length === 0 && untestable.length === 0) {
    // The MAIN pane carries the one explanation — the panel stays quiet.
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-center text-xs text-muted-foreground">No claims extracted yet.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border p-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search claims…"
          aria-label="Search claims"
          className={`${SELECT} w-full`}
        />
      </div>

      {/* Down only — every row line truncates, so sideways scroll is never right. */}
      {groups.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">No claims match this search.</div>
      ) : (
        <div
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          role="list"
          aria-label="Claim corpus"
        >
          {groups.map((group) => (
            <div key={group.doc}>
              <div className={DOC_HEADER}>
                <span className="truncate">{group.doc}</span>
                <span className="shrink-0 pl-2">{claimsIn(group)}</span>
              </div>
              {group.sections.map((section) => (
                <div key={section.anchor}>
                  <div className={SECTION_HEADER}>
                    <span className="truncate">{section.headingText ?? section.anchor}</span>
                    <span className="shrink-0 pl-2">{section.claims.length}</span>
                  </div>
                  {section.claims.map((claim) => (
                    <ClaimRow
                      key={claim.id}
                      claim={claim}
                      active={activeId === claim.id}
                      onOpen={onOpen}
                      setRef={rowRefs.set(claim.id)}
                    />
                  ))}
                </div>
              ))}
              {group.untestable.length > 0 && (
                <div>
                  <div className={`${SECTION_HEADER} italic`}>
                    <HoverPopover
                      portal
                      width="narrow"
                      content="Statements the docs make that nothing can falsify — extraction refused them rather than inventing a test."
                    >
                      <span className="truncate underline decoration-dotted underline-offset-2">Not claimed</span>
                    </HoverPopover>
                    <span className="shrink-0 pl-2">{group.untestable.length}</span>
                  </div>
                  {group.untestable.map((entry) => (
                    <UntestableRow
                      key={entry.id}
                      entry={entry}
                      active={activeId === entry.id}
                      onOpen={onOpen}
                      setRef={rowRefs.set(entry.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
