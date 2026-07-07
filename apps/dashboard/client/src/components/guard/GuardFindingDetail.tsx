/**
 * A birth-finding tab's MAIN-PANE detail — the GuardScenarioDetail analog for a
 * finding row. A finding is a candidate scenario that failed birth validation
 * twice and was NOT committed as a guard, so there is no YAML source or run
 * result to show; the detail is the failure story: the binding (doc § section +
 * view-in-spec), the failed step's expected/actual, and the evidence-transcript
 * path when one was written. Read-only; drift-vs-defect is the developer's call.
 */

import { ArrowUpRight, X } from 'lucide-react';
import { sectionLeaf } from '@/lib/guard-drifts';
import type { GuardFindingRowData } from '@/lib/guard-list-rows';
import { GuardFindingBadge } from './GuardFindingBadge';

const PRE =
  'mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-2 font-mono text-[11px] text-foreground';
const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

export function GuardFindingDetail({
  row,
  onClose,
  onOpenSpec,
}: {
  row: GuardFindingRowData;
  onClose: () => void;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const f = row.finding;
  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header — title is primary; the section slug rides as small mono meta. */}
      <div className="flex items-start justify-between gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GuardFindingBadge />
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {row.headingText ?? sectionLeaf(row.anchor)}
            </span>
          </div>
          <h2 className="mt-1 text-sm font-semibold text-foreground">{f.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close finding"
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
          <div className="break-all font-mono text-sm text-foreground">{f.doc}</div>
          <div className="break-all text-sm leading-relaxed text-muted-foreground">§ {f.anchor}</div>
          <div>
            <button
              type="button"
              onClick={() => onOpenSpec(f.doc, f.anchor)}
              className="mt-1.5 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              View in spec
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* What went wrong */}
        <div>
          <div className={LABEL}>
            Failed at step <span className="text-foreground">{f.step}</span>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Expected</span>
            <pre className={PRE}>{f.expected}</pre>
          </div>
          <div className="mt-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Actual</span>
            <pre className={PRE}>{f.actual}</pre>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">
          A candidate scenario for this section failed birth validation twice — a generation defect or real drift. It
          was not committed as a guard; regenerate once the section (or the engine) is fixed.
        </p>

        {/* Evidence pointer — a note only; the transcript is not fetched here. */}
        {f.evidencePath && (
          <div>
            <div className={LABEL}>Evidence</div>
            <code className="break-all text-[11px] text-muted-foreground">{f.evidencePath}</code>
          </div>
        )}
      </div>
    </div>
  );
}
