import { ArrowRight, Check, Github, Minus, Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

type Cell = 'yes' | 'no' | 'partial' | string;

type Row = { capability: string; tc: Cell; eslint: Cell; sonar: Cell };

const ROWS: Row[] = [
  {
    capability: 'AI-aware (hallucinated APIs, fabricated imports)',
    tc: 'yes',
    eslint: 'no',
    sonar: 'no',
  },
  {
    capability: 'Cross-file architecture (circular deps, layer violations)',
    tc: 'yes',
    eslint: 'no',
    sonar: 'partial',
  },
  {
    capability: 'Business-logic drift detection',
    tc: 'Preview',
    eslint: 'no',
    sonar: 'no',
  },
  {
    capability: 'Setup',
    tc: 'npx, zero config',
    eslint: 'Config + plugins',
    sonar: 'Server install',
  },
  {
    capability: 'Where your code runs',
    tc: 'Local',
    eslint: 'Local',
    sonar: 'Server / SaaS',
  },
  {
    capability: 'License',
    tc: 'MIT',
    eslint: 'MIT',
    sonar: 'LGPL',
  },
];

export function OpenSource() {
  const left = useReveal<HTMLDivElement>();
  const right = useReveal<HTMLDivElement>();
  return (
    <section id="open-source" className="relative border-b border-border py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          {/* Left: pitch */}
          <div ref={left.ref} className={cn('reveal', left.visible && 'visible')}>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
              <Check className="h-3 w-3" />
              Free forever &middot; MIT license
            </div>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              The open source CLI &amp; dashboard.
              <span className="block text-gradient-accent">Yours to run, fork, ship.</span>
            </h2>
            <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Everything you need to validate a codebase end-to-end is on npm. The CLI
              runs locally and the dashboard runs locally. Your code, your prompts, and
              your business-logic specs never leave your machine unless you explicitly
              enable LLM checks.
            </p>

            {/* Install */}
            <div className="mt-8 space-y-3">
              <CommandRow label="One-shot analyze" cmd="npx truecourse analyze" />
              <CommandRow label="Open the dashboard" cmd="npx truecourse dashboard" />
              <CommandRow
                label="Install the pre-commit hook"
                cmd="truecourse hooks install"
              />
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="https://github.com/truecourse-ai/truecourse"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium transition-colors hover:border-border-strong"
              >
                <Github className="h-4 w-4" />
                Star on GitHub
                <span className="ml-1 inline-flex items-center gap-1 rounded-md border border-border bg-background/50 px-1.5 py-0.5 text-xs text-muted-foreground">
                  <Star className="h-3 w-3" />
                  ★
                </span>
              </a>
              <a
                href="https://www.npmjs.com/package/truecourse"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-4 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/25"
              >
                View on npm
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Right: comparison table */}
          <div
            ref={right.ref}
            style={{ ['--delay' as string]: '120ms' }}
            className={cn('reveal', right.visible && 'visible')}
          >
            <div className="surface overflow-hidden rounded-2xl border border-border">
              {/* Header row */}
              <div className="grid grid-cols-[1.5fr_repeat(3,1fr)] border-b border-border bg-background/30">
                <div className="px-4 py-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Capability
                </div>
                <ColHead label="TrueCourse" highlight />
                <ColHead label="ESLint / Pylint" />
                <ColHead label="SonarQube" />
              </div>

              {/* Rows */}
              {ROWS.map((row, i) => (
                <div
                  key={row.capability}
                  className={cn(
                    'grid grid-cols-[1.5fr_repeat(3,1fr)] items-center text-sm transition-colors hover:bg-muted/15',
                    i !== ROWS.length - 1 && 'border-b border-border',
                  )}
                >
                  <div className="px-4 py-3 text-[12.5px] text-foreground/90">
                    {row.capability}
                  </div>
                  <CellView value={row.tc} highlight />
                  <CellView value={row.eslint} />
                  <CellView value={row.sonar} />
                </div>
              ))}
            </div>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Comparison is illustrative; mileage varies by configuration. Run TrueCourse
              alongside what you already use.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ColHead({ label, highlight }: { label: string; highlight?: boolean }) {
  return (
    <div className="border-l border-border px-3 py-3 text-center">
      <div
        className={cn(
          'text-[11px] font-semibold',
          highlight ? 'text-accent' : 'text-foreground/80',
        )}
      >
        {label}
      </div>
    </div>
  );
}

function CellView({ value, highlight }: { value: Cell; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-center border-l border-border px-3 py-3">
      {value === 'yes' ? (
        <span
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-full ring-1 ring-inset',
            highlight
              ? 'bg-accent/15 text-accent ring-accent/30'
              : 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
          )}
        >
          <Check className="h-3 w-3" />
        </span>
      ) : value === 'no' ? (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/70 ring-1 ring-inset ring-border">
          <Minus className="h-3 w-3" />
        </span>
      ) : value === 'partial' ? (
        <span className="text-[11px] text-amber-300/90">Some</span>
      ) : (
        <span
          className={cn(
            'text-center text-[11px] leading-tight',
            highlight ? 'text-accent' : 'text-muted-foreground',
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function CommandRow({ label, cmd }: { label: string; cmd: string }) {
  return (
    <div className="surface group flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 font-mono text-sm">
          <span className="text-muted-foreground">$ </span>
          {cmd}
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(cmd)}
        className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors group-hover:border-border-strong group-hover:text-foreground"
      >
        Copy
      </button>
    </div>
  );
}
