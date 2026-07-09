/**
 * A ready-but-held tab's MAIN-PANE detail — the GuardFindingDetail analog for a
 * held row. A held scenario passed birth validation but its section did NOT settle
 * (a sibling finding or authoring error), so the all-or-nothing persist withheld
 * it. The detail is the limbo story: the binding (doc § section + view-in-spec),
 * WHAT HOLDS IT (the section's birth findings — click-through to their tab — and
 * its authoring errors' messages), and the authored YAML that WILL land once the
 * section settles whole. Read-only.
 */

import { ArrowUpRight, X } from 'lucide-react';
import { sectionLeaf } from '@/lib/guard-drifts';
import type { GuardHeldRowData } from '@/lib/guard-list-rows';
import { GuardHeldBadge } from './GuardHeldBadge';
import { GuardFindingBadge } from './GuardFindingBadge';

const PRE =
  'mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-2 font-mono text-[11px] text-foreground';
const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

export function GuardHeldDetail({
  row,
  onClose,
  onOpenSpec,
  onOpenFinding,
}: {
  row: GuardHeldRowData;
  onClose: () => void;
  onOpenSpec: (doc: string, section: string) => void;
  /** Open a blocking finding's own detail tab by its finding-row key. */
  onOpenFinding: (findingId: string) => void;
}) {
  const { findings, errors } = row.blockers;
  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header — title is primary; the section heading rides as small mono meta. */}
      <div className="flex items-start justify-between gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GuardHeldBadge />
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {row.headingText ?? sectionLeaf(row.anchor)}
            </span>
          </div>
          <h2 className="mt-1 text-sm font-semibold text-foreground">{row.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close held scenario"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-auto px-6 py-4">
        {/* Binding */}
        <div>
          <div className={LABEL}>Binding</div>
          <div className="break-all font-mono text-sm text-foreground">{row.doc}</div>
          <div className="break-all text-sm leading-relaxed text-muted-foreground">§ {row.anchor}</div>
          <div>
            <button
              type="button"
              onClick={() => onOpenSpec(row.doc, row.anchor)}
              className="mt-1.5 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              View in spec
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* What holds it — the section's findings (click-through) + errors (messages). */}
        <div>
          <div className={LABEL}>What holds it</div>
          <div className="space-y-1.5">
            {findings.map((b) => (
              <button
                key={b.findingId}
                type="button"
                onClick={() => onOpenFinding(b.findingId)}
                className="flex w-full items-center gap-2 rounded border border-border px-2 py-1.5 text-left transition-colors hover:bg-muted/40"
              >
                <GuardFindingBadge />
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{b.finding.title}</span>
                <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
            ))}
            {errors.map((e, i) => (
              <pre key={`err-${i}`} className={PRE}>
                {e.message}
              </pre>
            ))}
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">
          This scenario passed birth validation, but its section did not settle — a sibling finding or authoring error
          held the whole section back. It lands the next time the section settles clean; resolve its blockers, then
          re-generate.
        </p>

        {/* The authored YAML that will land — the same code-block idiom scenario source uses. */}
        <div>
          <div className={LABEL}>Scenario source</div>
          <pre className={PRE} aria-label="scenario source">
            {row.ready.yaml}
          </pre>
        </div>
      </div>
    </div>
  );
}
