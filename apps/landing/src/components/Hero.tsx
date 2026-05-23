import { useState } from 'react';
import { ArrowRight, Check, Copy, Sparkles, Terminal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

const INSTALL = 'npx truecourse analyze';

export function Hero() {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(INSTALL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <section
      id="top"
      className="relative isolate overflow-hidden border-b border-border pt-32 pb-24 sm:pt-40 sm:pb-32"
    >
      <div className="bg-radial-glow absolute inset-0 -z-10" />
      <div className="bg-grid absolute inset-0 -z-10" />

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <Link
            to="/#why-now"
            style={{ ['--delay' as string]: '0ms' }}
            className="animate-fade-up animate-pulse-ring mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur-md transition-colors hover:border-border-strong hover:text-foreground"
          >
            <Sparkles className="h-3 w-3 text-accent" />
            New &middot; Verified knowledge for AI-assisted teams (preview)
            <ArrowRight className="h-3 w-3" />
          </Link>

          <h1
            style={{ ['--delay' as string]: '80ms' }}
            className="animate-fade-up mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl"
          >
            <span className="text-gradient">Code drifts. Decisions get forgotten.</span>
            <br />
            <span className="text-gradient-accent">TrueCourse closes the gap.</span>
          </h1>

          <p
            style={{ ['--delay' as string]: '200ms' }}
            className="animate-fade-up mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl"
          >
            The verified knowledge layer for engineering. We compile your team&apos;s
            decisions into machine-readable contracts and check every commit against
            them — deterministically.
          </p>

          {/* Install / CTA */}
          <div
            style={{ ['--delay' as string]: '320ms' }}
            className="animate-fade-up mx-auto mt-10 flex max-w-2xl flex-col items-center gap-4 sm:flex-row sm:justify-center"
          >
            <button
              type="button"
              onClick={copy}
              className={cn(
                'glow-border group relative flex h-12 w-full max-w-md items-center gap-3 rounded-xl border border-border bg-card/80 px-4 text-left font-mono text-sm shadow-2xl shadow-black/40 backdrop-blur-md transition-all sm:w-auto',
                'hover:border-border-strong',
              )}
            >
              <Terminal className="h-4 w-4 shrink-0 text-accent" />
              <span className="flex-1 truncate">
                <span className="text-muted-foreground">$ </span>
                {INSTALL}
              </span>
              <span
                className={cn(
                  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 text-muted-foreground transition-colors',
                  copied && 'border-emerald-500/40 text-emerald-400',
                )}
                aria-hidden
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </span>
            </button>

            <Link
              to="/request-access"
              className="group inline-flex h-12 items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-5 text-sm font-medium text-foreground backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/25"
            >
              Request access
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <p
            style={{ ['--delay' as string]: '420ms' }}
            className="animate-fade-up mt-4 text-xs text-muted-foreground"
          >
            Open source MIT &middot; Works on TypeScript, JavaScript, Python &middot; Zero config
          </p>
        </div>

        {/* Hero preview */}
        <div style={{ ['--delay' as string]: '520ms' }} className="animate-fade-up">
          <HeroPreview />
        </div>
      </div>
    </section>
  );
}

function HeroPreview() {
  return (
    <div className="relative mx-auto mt-16 max-w-5xl">
      {/* Halo */}
      <div className="bg-radial-glow absolute -inset-x-12 -top-10 -bottom-10 -z-10 opacity-60 blur-3xl" />

      <div className="glow-border overflow-hidden rounded-2xl border border-border bg-card/80 shadow-2xl shadow-black/50 backdrop-blur-md">
        {/* Window chrome */}
        <div className="flex items-center justify-between border-b border-border bg-background/40 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            ~/projects/sample-project · truecourse analyze
          </div>
          <div className="w-12" />
        </div>

        <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
          {/* Terminal — matches the real clack-formatted CLI output */}
          <ClackTerminal />

          {/* Top findings panel — what `truecourse list` would surface */}
          <div className="bg-background/40 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Top findings &middot; sample-project</h3>
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                197 TOTAL
              </span>
            </div>
            <ul className="mt-3 space-y-2.5">
              <Finding
                severity="critical"
                rule="business-logic-drift"
                file="billing/refund.ts"
                category="Drift"
              />
              <Finding
                severity="high"
                rule="hardcoded-secret"
                file="auth/jwt.ts"
                category="Security"
              />
              <Finding
                severity="high"
                rule="circular-dependency"
                file="billing/usage.ts"
                category="Architecture"
              />
              <Finding
                severity="high"
                rule="unhandled-promise"
                file="workers/cron.ts"
                category="Reliability"
              />
            </ul>
            <div className="mt-4 rounded-lg border border-border bg-card/60 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="text-foreground">Tip:</span> install the pre-commit hook
              so new high-severity findings never reach main.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Condensed render of the real `truecourse analyze` clack-formatted output.
 * Frame glyphs, strings, and indentation match the actual CLI; interactive
 * prompts are stripped so the preview stays scannable for visitors.
 */
function ClackTerminal() {
  return (
    <div className="border-b border-border p-5 font-mono text-[12.5px] leading-[1.55] md:border-b-0 md:border-r">
      {/* Prompt */}
      <div className="flex">
        <span className="text-muted-foreground">$&nbsp;</span>
        <span className="text-foreground">npx truecourse analyze</span>
      </div>

      <div className="mt-1.5">
        {/* Intro */}
        <FrameLine glyph="┌">
          <span className="text-foreground">Analyzing repository</span>
        </FrameLine>
        <FrameLine glyph="│" />

        {/* Repo */}
        <FrameLine glyph="◇">
          <span className="text-muted-foreground">Repository:</span>{' '}
          <span className="text-foreground">sample-project</span>
        </FrameLine>
        <FrameLine glyph="│" />

        {/* Inline progress: parse + scan */}
        <ProgressLine label="Parsing repository" value="3 services, 20 files" />
        <ProgressLine label="Scanning files" value="20 files" />
        <FrameLine glyph="│" />

        {/* Category checks (incl. business-logic drift preview) */}
        <ProgressLine label="Security checks" value="3 violations" tone="warn" />
        <ProgressLine label="Bugs checks" value="2 violations" tone="warn" />
        <ProgressLine label="Architecture checks" value="24 violations" tone="warn" />
        <ProgressLine label="Performance checks" value="Clean" tone="ok" />
        <ProgressLine label="Reliability checks" value="5 violations" tone="warn" />
        <ProgressLine label="Code quality checks" value="156 violations" tone="warn" />
        <ProgressLine label="Database checks" value="1 violation" tone="warn" />
        <ProgressLine label="Style checks" value="2 violations" tone="warn" />
        <ProgressLine label="Business-logic drift" value="4 violations" tone="warn" />
        <ProgressLine label="Saving results" value="Done" tone="ok" />

        <FrameLine glyph="│" />

        {/* Final success */}
        <FrameLine glyph="◆">
          <span className="text-foreground">Analysis complete</span>
        </FrameLine>
        <RawLine />
        <RawLine>
          <span className="text-foreground">197 violations</span>{' '}
          <span className="text-muted-foreground">(</span>
          <span className="text-rose-500">1 critical</span>
          <span className="text-muted-foreground">, </span>
          <span className="text-rose-400">6 high</span>
          <span className="text-muted-foreground">, </span>
          <span className="text-amber-400">114 medium</span>
          <span className="text-muted-foreground">, </span>
          <span className="text-amber-300">76 low</span>
          <span className="text-muted-foreground">)</span>
        </RawLine>
        <RawLine />

        <FrameLine glyph="│" />
        <FrameLine glyph="●" glyphClass="text-sky-400">
          <span className="text-muted-foreground">Run</span>{' '}
          <span className="text-foreground">`truecourse list`</span>{' '}
          <span className="text-muted-foreground">to see full details.</span>
        </FrameLine>
        <FrameLine glyph="│" />
        <FrameLine glyph="└">
          <span className="text-muted-foreground">
            Analysis complete — view results with:
          </span>{' '}
          <span className="text-foreground">truecourse dashboard</span>
        </FrameLine>
      </div>

      {/* Blinking prompt */}
      <div className="mt-2 flex items-center">
        <span className="text-muted-foreground">$&nbsp;</span>
        <span
          className="animate-blink ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-emerald-400"
          aria-hidden
        />
      </div>
    </div>
  );
}

function FrameLine({
  glyph,
  glyphClass = 'text-cyan-400/80',
  children,
}: {
  glyph: string;
  glyphClass?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex">
      <span className={cn('w-5 shrink-0', glyphClass)}>{glyph}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

function RawLine({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex">
      <span className="w-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

/** Progress line with the inline ● bullet and a `label — value` body. */
function ProgressLine({
  label,
  value,
  tone = 'ok',
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className="flex">
      <span className="w-5 shrink-0 pl-2 text-muted-foreground/70">●</span>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground">{label}</span>{' '}
        <span className="text-muted-foreground">—</span>{' '}
        <span className={tone === 'warn' ? 'text-amber-200' : 'text-emerald-300'}>
          {value}
        </span>
      </span>
    </div>
  );
}

function Finding({
  severity,
  rule,
  file,
  category,
}: {
  severity: 'critical' | 'high' | 'medium' | 'low';
  rule: string;
  file: string;
  category: string;
}) {
  const tone =
    severity === 'critical'
      ? 'bg-rose-600/20 text-rose-200 ring-rose-500/40'
      : severity === 'high'
        ? 'bg-rose-500/15 text-rose-300 ring-rose-500/25'
        : severity === 'medium'
          ? 'bg-amber-500/15 text-amber-200 ring-amber-500/25'
          : 'bg-sky-500/15 text-sky-300 ring-sky-500/25';
  return (
    <li className="rounded-lg border border-border bg-card/40 p-2.5 transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ring-1 ring-inset',
            tone,
          )}
        >
          {severity}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">{category}</span>
      </div>
      <div className="mt-1.5 font-mono text-[12.5px]">{rule}</div>
      <div className="font-mono text-[11px] text-muted-foreground">{file}</div>
    </li>
  );
}
