import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export function CTASection() {
  return (
    <section id="cta" className="relative overflow-hidden py-28 sm:py-36">
      <div className="bg-radial-glow absolute inset-0 -z-10 opacity-70" />
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
          <span className="text-gradient">Accelerate your</span>{' '}
          <span className="text-gradient-accent">spec-driven development.</span>
        </h2>

        <div className="mt-10 flex justify-center">
          <Link
            to="/request-access"
            className="glow-border group inline-flex h-12 items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-6 text-sm font-medium text-foreground backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/25"
          >
            Request access
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">truecourse.dev</p>
      </div>
    </section>
  );
}
