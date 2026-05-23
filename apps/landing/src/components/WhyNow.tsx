import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

const BULLETS = [
  'AI coding agents are shipping a growing share of production code',
  'Every agent reads your codebase. None reads your decisions.',
  'The bottleneck moved from writing code to knowing what to write',
  'Without a verified knowledge base, AI accelerates the wrong direction',
];

export function WhyNow() {
  return (
    <section id="why-now" className="relative border-b border-border py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Why now
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            <span className="text-gradient">AI is writing your code.</span>{' '}
            <span className="text-gradient-accent">
              It has no idea what your team decided.
            </span>
          </h2>
        </div>

        <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {BULLETS.map((text, i) => (
            <Bullet key={text} text={text} delayMs={i * 80} />
          ))}
        </ul>

        <div className="mt-12">
          <Callout />
        </div>
      </div>
    </section>
  );
}

function Bullet({ text, delayMs }: { text: string; delayMs: number }) {
  const { ref, visible } = useReveal<HTMLLIElement>();
  return (
    <li
      ref={ref}
      style={{ ['--delay' as string]: `${delayMs}ms` }}
      className={cn(
        'reveal surface-hover flex items-start gap-3 rounded-2xl border border-border bg-card/40 p-5 transition-colors hover:border-border-strong hover:bg-card',
        visible && 'visible',
      )}
    >
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_12px_2px] shadow-accent/40"
        aria-hidden
      />
      <p className="text-base leading-relaxed text-foreground/90">{text}</p>
    </li>
  );
}

function Callout() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cn(
        'reveal glow-border relative rounded-2xl border border-accent/40 bg-accent/10 p-6 sm:p-8',
        visible && 'visible',
      )}
    >
      <p className="text-balance text-lg leading-relaxed text-foreground sm:text-xl">
        The next 10x in engineering comes from giving AI access to your team&apos;s
        decisions.
      </p>
    </div>
  );
}
