import { useState } from 'react';
import { ArrowRight, Check, Copy, Sparkles, Terminal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

const INSTALL = 'npx truecourse spec scan';

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
            New &middot; Verified knowledge for AI-native engineering teams (preview)
            <ArrowRight className="h-3 w-3" />
          </Link>

          <h1
            style={{ ['--delay' as string]: '80ms' }}
            className="animate-fade-up mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl"
          >
            <span className="text-gradient">AI ships your code.</span>
            <br />
            <span className="text-gradient-accent">
              We make sure it ships what your team decided.
            </span>
          </h1>

          <p
            style={{ ['--delay' as string]: '200ms' }}
            className="animate-fade-up mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl"
          >
            The verified knowledge layer for AI-native engineering teams. We scan your
            docs, compile your team&apos;s decisions into machine-readable contracts,
            then check every commit against them, including every AI-generated one.
            Deterministically, with no LLM in the verification loop.
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
            ~/projects/sample-project · truecourse spec scan
          </div>
          <div className="w-12" />
        </div>

        <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
          {/* Terminal: the real spec-scan flow from il-framework */}
          <ClackTerminal />

          {/* Drift report panel: what truecourse verify produces after setup */}
          <div className="bg-background/40 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                Drift report &middot; <span className="text-muted-foreground">truecourse verify</span>
              </h3>
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                3 DRIFTS
              </span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Runs on every commit once the spec is applied.
            </p>
            <ul className="mt-3 space-y-2.5">
              <Finding
                severity="critical"
                rule="SignatureDetection.score"
                file="entity.field.type"
                category="Drift"
              />
              <Finding
                severity="critical"
                rule="DetectionStatus"
                file="state-machine.transition"
                category="Drift"
              />
              <Finding
                severity="high"
                rule="SignatureDetection.flaggedAt"
                file="entity.field.mutability"
                category="Drift"
              />
            </ul>
            <div className="mt-4 rounded-lg border border-border bg-card/60 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="text-foreground">Tip:</span> install the pre-commit hook
              so new drifts never reach main.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Condensed render of the real `truecourse spec scan` clack-formatted
 * output. Mirrors SCAN_STEPS in packages/core/src/commands/spec-in-process.ts
 * (Discovering docs, Extracting claims, Merging + detecting conflicts) and
 * the summary printed by tools/cli/src/commands/spec.ts#runSpecScan.
 */
function ClackTerminal() {
  return (
    <div className="border-b border-border p-5 font-mono text-[12.5px] leading-[1.55] md:border-b-0 md:border-r">
      {/* Prompt */}
      <div className="flex">
        <span className="text-muted-foreground">$&nbsp;</span>
        <span className="text-foreground">npx truecourse spec scan</span>
      </div>

      <div className="mt-1.5">
        {/* Intro */}
        <FrameLine glyph="┌">
          <span className="text-foreground">Spec scan</span>
        </FrameLine>
        <FrameLine glyph="│" />

        {/* The 3 SCAN_STEPS */}
        <ProgressLine label="Discovering docs" value="34 docs" tone="ok" />
        <ProgressLine label="Extracting claims" value="287 claims" tone="ok" />
        <ProgressLine
          label="Merging + detecting conflicts"
          value="42 open"
          tone="warn"
        />
        <FrameLine glyph="│" />

        {/* Summary rows from runSpecScan */}
        <FrameLine glyph="◇">
          <span className="text-muted-foreground">docs&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
          <span className="text-foreground">34</span>
        </FrameLine>
        <FrameLine glyph="◇">
          <span className="text-muted-foreground">claims&nbsp;&nbsp;&nbsp;&nbsp;</span>
          <span className="text-foreground">287</span>
        </FrameLine>
        <FrameLine glyph="◇">
          <span className="text-muted-foreground">resolved&nbsp;&nbsp;</span>
          <span className="text-foreground">245</span>
        </FrameLine>
        <FrameLine glyph="◇">
          <span className="text-muted-foreground">open&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
          <span className="text-amber-300">42</span>
        </FrameLine>
        <FrameLine glyph="│" />

        <FrameLine glyph="●" glyphClass="text-sky-400">
          <span className="text-muted-foreground">
            Resolve in the dashboard, or run
          </span>{' '}
          <span className="text-foreground">truecourse spec resolve --all-defaults</span>
        </FrameLine>
        <FrameLine glyph="│" />
        <FrameLine glyph="└">
          <span className="text-foreground">42 open.</span>
        </FrameLine>

        <RawLine />
        <RawLine>
          <span className="text-muted-foreground">
            Apply the spec, then verify runs on every commit:
          </span>
        </RawLine>
        <RawLine>
          <span className="text-foreground">$ truecourse spec apply</span>
          <span className="text-muted-foreground"> &amp;&amp; truecourse verify</span>
        </RawLine>
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
