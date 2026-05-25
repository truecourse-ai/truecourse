import { Cog, FileText, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

type Step = {
  num: string;
  Icon: typeof FileText;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    num: '1',
    Icon: FileText,
    title: 'Capture',
    body: "Scan your docs, ADRs, READMEs, and Slack threads. Extract every decision your team made, with provenance back to the source.",
  },
  {
    num: '2',
    Icon: Cog,
    title: 'Compile',
    body: 'Decisions become machine-readable contracts. Versioned, reviewable, lives alongside your code.',
  },
  {
    num: '3',
    Icon: ShieldCheck,
    title: 'Verify',
    body: 'A deterministic engine, no LLM in the loop, checks every change against the contracts. Same input, same result, every time.',
  },
];

export function OurApproach() {
  return (
    <section
      id="our-approach"
      className="relative border-b border-border py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-4xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Our approach
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            <span className="text-gradient">
              We compile your team&apos;s decisions into contracts.
            </span>{' '}
            <span className="text-gradient-accent">
              A deterministic engine checks every change against them.
            </span>
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <StepCard key={s.num} step={s} delayMs={i * 120} />
          ))}
        </div>

        <p className="mt-14 text-balance text-base leading-relaxed text-foreground/85 sm:text-lg">
          <span className="text-foreground">
            Every kind of drift surfaced.
          </span>{' '}
          <span className="text-muted-foreground">
            Mechanical, behavioral, architectural.
          </span>
        </p>
      </div>
    </section>
  );
}

function StepCard({ step, delayMs }: { step: Step; delayMs: number }) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  const { Icon } = step;
  return (
    <div
      ref={ref}
      style={{ ['--delay' as string]: `${delayMs}ms` }}
      className={cn(
        'reveal surface-hover relative flex flex-col rounded-2xl border border-border bg-card/40 p-7 transition-colors hover:border-border-strong sm:p-8',
        visible && 'visible',
      )}
    >
      <div className="flex items-center gap-4">
        <span
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/40 bg-accent/15 text-accent shadow-[0_0_24px_-6px] shadow-accent/30"
          aria-hidden
        >
          <Icon className="h-6 w-6" />
        </span>
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Step {step.num}
          </div>
          <h3 className="mt-0.5 text-balance text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {step.title}
          </h3>
        </div>
      </div>
      <p className="mt-6 text-base leading-relaxed text-muted-foreground">
        {step.body}
      </p>
    </div>
  );
}
