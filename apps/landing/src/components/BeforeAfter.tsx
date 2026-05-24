import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';
import { Illustration } from './Illustration';

const BEFORE = [
  'Decisions live in 5+ tools, none authoritative',
  'AI agents commit code blind to every decision your team made',
  'Drift is discovered in production, not at commit time',
];

const AFTER = [
  'One verified knowledge base, every decision findable in seconds',
  'AI agents bound by what your team actually decided',
  'Every commit checked against the contracts in real time',
];

export function BeforeAfter() {
  return (
    <section
      id="before-after"
      className="relative border-b border-border py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Before / After
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            <span className="text-gradient">From chaos to a</span>{' '}
            <span className="text-gradient-accent">verified source of truth.</span>
          </h2>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-16 md:grid-cols-2 md:gap-12">
          <Column
            label="BEFORE"
            labelClassName="text-muted-foreground"
            illustration={
              <Illustration
                src="/illustrations/slide9-before.png"
                alt="Engineering knowledge scattered across Notion, Confluence, GitHub, Slack and other tools, with tangled connections and a confused engineer and AI agent"
                className="w-full"
                halo={false}
              />
            }
            bullets={BEFORE}
            bulletTone="muted"
            delayMs={0}
          />
          <Column
            label="AFTER"
            labelClassName="text-accent"
            illustration={
              <Illustration
                src="/illustrations/slide9-after.png"
                alt="Documentation sources and code feeding into the Verified Knowledge Base, then through the TrueCourse Engine to AI agents and engineers"
                className="w-full"
              />
            }
            bullets={AFTER}
            bulletTone="accent"
            delayMs={120}
          />
        </div>
      </div>
    </section>
  );
}

function Column({
  label,
  labelClassName,
  illustration,
  bullets,
  bulletTone,
  delayMs,
}: {
  label: string;
  labelClassName: string;
  illustration: React.ReactNode;
  bullets: string[];
  bulletTone: 'muted' | 'accent';
  delayMs: number;
}) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ ['--delay' as string]: `${delayMs}ms` }}
      className={cn('reveal flex flex-col', visible && 'visible')}
    >
      <p
        className={cn(
          'text-xs font-semibold uppercase tracking-[0.22em]',
          labelClassName,
        )}
      >
        {label}
      </p>
      <div className="mt-6 flex flex-1 items-center justify-center">{illustration}</div>
      <ul className="mt-6 space-y-3">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-3">
            <span
              className={cn(
                'mt-2 h-1.5 w-1.5 shrink-0 rounded-full',
                bulletTone === 'accent'
                  ? 'bg-accent shadow-[0_0_8px_2px] shadow-accent/40'
                  : 'bg-muted-foreground/60',
              )}
              aria-hidden
            />
            <span className="text-sm leading-relaxed text-foreground/85 sm:text-base">
              {b}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
