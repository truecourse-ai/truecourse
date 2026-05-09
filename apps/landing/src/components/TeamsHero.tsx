import { ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

export function TeamsHero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-border pt-32 pb-16 sm:pt-40 sm:pb-24">
      <div className="bg-radial-glow absolute inset-0 -z-10" />
      <div className="bg-grid absolute inset-0 -z-10" />

      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <Link
          to="/"
          style={{ ['--delay' as string]: '0ms' }}
          className="animate-fade-up animate-pulse-ring mx-auto inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent backdrop-blur-md transition-colors hover:bg-accent/15"
        >
          <Sparkles className="h-3 w-3" />
          Closed beta &middot; By invitation
        </Link>

        <h1
          style={{ ['--delay' as string]: '80ms' }}
          className="animate-fade-up mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
        >
          <span className="text-gradient">TrueCourse</span>{' '}
          <span className="text-gradient-accent">for teams.</span>
        </h1>

        <p
          style={{ ['--delay' as string]: '200ms' }}
          className="animate-fade-up mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl"
        >
          Runs on top of GitHub. Reviews every PR, blocks the drift, and rolls the
          findings into a dashboard your engineering leads actually want: who&apos;s
          shipping, what&apos;s drifting, where each engineer needs support.
        </p>

        <div
          style={{ ['--delay' as string]: '320ms' }}
          className="animate-fade-up mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <a
            href="#access"
            className="group inline-flex h-12 items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-5 text-sm font-medium text-foreground backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/25"
          >
            Request access
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <Link
            to="/#open-source"
            className="inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-card/60 px-5 text-sm font-medium backdrop-blur-md transition-colors hover:border-border-strong"
          >
            Try the open source CLI
          </Link>
        </div>
      </div>
    </section>
  );
}
