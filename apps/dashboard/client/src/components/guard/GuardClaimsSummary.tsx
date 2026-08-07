/**
 * The corpus at a glance, on the Coverage tab's no-document state: what the docs
 * claim, how much of it anything proves, and the per-document breakdown that says
 * WHERE the unproven part is.
 *
 * It lives here because that is the only question a claim total answers —
 * "which document should I open?" — and opening one is exactly what the rows do.
 * The claims themselves are read inside the section that states them; this is the
 * count, not a second inventory.
 */

import type { GuardClaimsView } from '@truecourse/shared';
import { EntityList } from '@/components/ui/entity-list';
import { HoverPopover } from '@/components/ui/hover-popover';
import { formatGuardTime } from '@/lib/guard-drifts';
import { GUARD_CLAIM_COVERAGE, groupGuardClaims, type GuardUntestableEntry } from '@/lib/guard-claims';

/** One count of the totals row — the number first, its word after it. */
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

interface DocRow {
  doc: string;
  claims: number;
  proven: number;
  untestable: number;
}

export function GuardClaimsSummary({
  view,
  untestable,
  onOpenDoc,
}: {
  view: GuardClaimsView;
  untestable: readonly GuardUntestableEntry[];
  /** Open a document's coverage — what a per-doc row is for. */
  onOpenDoc: (ref: string, pinned: boolean) => void;
}) {
  const t = view.totals;
  const rows: DocRow[] = groupGuardClaims(view.claims, untestable).map((group) => {
    const claims = group.sections.flatMap((s) => s.claims);
    return {
      doc: group.doc,
      claims: claims.length,
      proven: claims.filter((c) => c.coverage === 'proven').length,
      untestable: group.untestable.length,
    };
  });

  return (
    <div role="region" aria-label="Claims overview" className="space-y-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Extracted claims</div>
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

      <div className="rounded border border-border">
        <EntityList<DocRow>
          variant="embedded"
          label="Claims by document"
          groups={[{ key: 'docs', label: 'By document', count: rows.length, items: rows }]}
          itemId={(row) => row.doc}
          onOpen={onOpenDoc}
          renderRow={(row) => (
            <div className="flex w-full items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{row.doc}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {row.claims} claim{row.claims === 1 ? '' : 's'} · {row.proven} proven
                {row.untestable > 0 ? ` · ${row.untestable} not claimed` : ''}
              </span>
            </div>
          )}
        />
      </div>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        A claim is one testable statement your documentation makes. Every flow guard writes is built out of these, so
        a claim nothing carries is a promise nothing tests. Open a document and click a section to read the claims it
        states, and what stands behind each one.
      </p>
    </div>
  );
}
