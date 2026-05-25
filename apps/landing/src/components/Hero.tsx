import { ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Hero() {
  return (
    <section
      id="top"
      className="relative isolate overflow-hidden border-b border-border pt-32 pb-32 sm:pt-40 sm:pb-40"
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
            The verified knowledge layer for AI-native engineering teams. We compile
            your team&apos;s decisions into machine-readable contracts and check every
            change against them. Deterministically, with no LLM in the verification
            loop.
          </p>

          <div
            style={{ ['--delay' as string]: '320ms' }}
            className="animate-fade-up mt-10 flex justify-center"
          >
            <Link
              to="/request-access"
              className="group inline-flex h-12 items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-6 text-base font-medium text-foreground backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/25"
            >
              Request access
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
