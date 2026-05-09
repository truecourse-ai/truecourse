import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

type Cell = boolean | string;
type Row = { feature: string; oss: Cell; teams: Cell; hint?: string };

const ROWS: Row[] = [
  { feature: 'Deterministic checks', oss: true, teams: true },
  { feature: 'LLM-powered checks', oss: true, teams: true },
  { feature: 'Local CLI &amp; dashboard', oss: true, teams: true },
  { feature: 'Diff mode (review only AI-changed lines)', oss: true, teams: true },
  { feature: 'Pre-commit hook', oss: true, teams: true },
  { feature: 'TS / JS / Python support', oss: true, teams: true },
  { feature: 'Per-repo config in git', oss: true, teams: true },
  { feature: 'Business-logic drift detection', oss: 'CLI preview', teams: 'PR + dashboard' },
  { feature: 'GitHub App (auto-review every PR)', oss: false, teams: true },
  { feature: 'Inline PR comments on findings', oss: false, teams: true },
  { feature: 'Merge-blocking on critical findings', oss: false, teams: true },
  { feature: 'Org &amp; team visibility dashboard', oss: false, teams: true },
  { feature: 'Per-engineer insights (PRs, drift, AI ratio)', oss: false, teams: true },
  { feature: 'Hosted control plane', oss: false, teams: true },
  { feature: 'SSO (SAML, SCIM)', oss: false, teams: true },
  { feature: 'Role-based access control', oss: false, teams: true },
  { feature: 'Audit logs', oss: false, teams: true },
  { feature: 'Custom rules &amp; LLM tuning', oss: false, teams: 'With our team' },
  { feature: 'Priority support &amp; SLAs', oss: 'Community', teams: 'Email + Slack' },
];

export function Comparison() {
  const table = useReveal<HTMLDivElement>({ threshold: 0.05 });
  return (
    <section className="relative border-b border-border py-24 sm:py-32">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            What changes
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Open source vs. teams.
          </h2>
          <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            The CLI stays open source forever. Teams adds the org-level surface area
            engineering leaders need, without forcing your code into a SaaS.
          </p>
        </div>

        <div
          ref={table.ref}
          className={cn(
            'surface reveal mt-12 overflow-hidden rounded-2xl border border-border',
            table.visible && 'visible',
          )}
        >
          {/* Header row */}
          <div className="grid grid-cols-[1.4fr_1fr_1fr] border-b border-border bg-background/30">
            <div className="px-5 py-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Feature
            </div>
            <div className="border-l border-border px-5 py-4">
              <div className="text-sm font-semibold">Open source</div>
              <div className="text-[11px] text-muted-foreground">Free forever &middot; MIT</div>
            </div>
            <div className="border-l border-border px-5 py-4">
              <div className="text-sm font-semibold text-gradient-accent inline-block">
                Teams
              </div>
              <div className="text-[11px] text-muted-foreground">Closed beta</div>
            </div>
          </div>

          {/* Rows */}
          {ROWS.map((row, i) => (
            <div
              key={row.feature}
              className={cn(
                'grid grid-cols-[1.4fr_1fr_1fr] items-center text-sm transition-colors hover:bg-muted/20',
                i !== ROWS.length - 1 && 'border-b border-border',
              )}
            >
              <div
                className="px-5 py-3.5 text-foreground/90"
                dangerouslySetInnerHTML={{ __html: row.feature }}
              />
              <CellView value={row.oss} />
              <CellView value={row.teams} highlight />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CellView({ value, highlight }: { value: Cell; highlight?: boolean }) {
  return (
    <div className="border-l border-border px-5 py-3.5">
      {value === true ? (
        <span
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-full',
            highlight
              ? 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/30'
              : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/25',
          )}
        >
          <Check className="h-3 w-3" />
        </span>
      ) : value === false ? (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/40 text-muted-foreground ring-1 ring-inset ring-border">
          <Minus className="h-3 w-3" />
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">{value}</span>
      )}
    </div>
  );
}
