import { Bot, Clock, Rocket, TrendingUp, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

type Bullet = {
  Icon: typeof Bot;
  text: string;
};

const BULLETS: Bullet[] = [
  {
    Icon: Bot,
    text: 'AI coding agents now ship a growing share of production code',
  },
  {
    Icon: TrendingUp,
    text: 'PR volume is climbing faster than reviewers can keep up',
  },
  {
    Icon: Clock,
    text: 'Senior engineers spend their day reviewing AI output instead of building',
  },
  {
    Icon: Zap,
    text: "Slowing AI down isn't the answer. Faster verification is.",
  },
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
            <span className="text-gradient">AI made writing code fast.</span>{' '}
            <span className="text-gradient-accent">Review is the new bottleneck.</span>
          </h2>
        </div>

        <ul className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {BULLETS.map((b, i) => (
            <BulletCard key={b.text} bullet={b} delayMs={i * 80} />
          ))}
        </ul>

        <div className="mt-14">
          <Callout />
        </div>
      </div>
    </section>
  );
}

function BulletCard({ bullet, delayMs }: { bullet: Bullet; delayMs: number }) {
  const { ref, visible } = useReveal<HTMLLIElement>();
  const { Icon } = bullet;
  return (
    <li
      ref={ref}
      style={{ ['--delay' as string]: `${delayMs}ms` }}
      className={cn(
        'reveal surface-hover flex items-start gap-5 rounded-2xl border border-border bg-card/40 p-6 transition-colors hover:border-border-strong hover:bg-card sm:p-7',
        visible && 'visible',
      )}
    >
      <span
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/40 bg-accent/15 text-accent shadow-[0_0_24px_-6px] shadow-accent/30"
        aria-hidden
      >
        <Icon className="h-6 w-6" />
      </span>
      <p className="text-balance text-lg leading-relaxed text-foreground/90 sm:text-xl">
        {bullet.text}
      </p>
    </li>
  );
}

function Callout() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cn(
        'reveal glow-border relative flex items-center gap-6 rounded-2xl border border-accent/40 bg-accent/10 p-7 sm:p-9',
        visible && 'visible',
      )}
    >
      <span
        className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-accent/50 bg-accent/20 text-accent shadow-[0_0_32px_-6px] shadow-accent/50"
        aria-hidden
      >
        <Rocket className="h-7 w-7" />
      </span>
      <p className="text-balance text-xl leading-relaxed text-foreground sm:text-2xl">
        The next 10x in engineering comes from verifying code at AI speed.
      </p>
    </div>
  );
}
