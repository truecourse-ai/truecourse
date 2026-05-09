import { ArrowRight, Check, Github, Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

export function OpenSource() {
  const left = useReveal<HTMLDivElement>();
  const right = useReveal<HTMLDivElement>();
  return (
    <section id="open-source" className="relative border-b border-border py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
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
          </div>

          {/* Right: install commands + GitHub / npm CTAs */}
          <div
            ref={right.ref}
            style={{ ['--delay' as string]: '120ms' }}
            className={cn('reveal', right.visible && 'visible')}
          >
            <div className="space-y-3">
              <CommandRow label="One-shot analyze" cmd="npx truecourse analyze" />
              <CommandRow label="Open the dashboard" cmd="npx truecourse dashboard" />
              <CommandRow
                label="Install the pre-commit hook"
                cmd="truecourse hooks install"
              />
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
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
        </div>
      </div>
    </section>
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
