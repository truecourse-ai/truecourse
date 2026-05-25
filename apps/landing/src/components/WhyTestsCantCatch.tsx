import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

type Tone = 'muted' | 'accent';

const CARDS: Array<{
  num: string;
  title: string;
  body: string;
  tone: Tone;
}> = [
  {
    num: '1',
    title: 'Tests verify what was written, not whether it was right',
    body: 'A test is written by the same engineer who wrote the code, from the same understanding of the spec. If they misread it, the test passes against the wrong implementation.',
    tone: 'muted',
  },
  {
    num: '2',
    title: "AI reviewers share the writer's hallucinations",
    body: "CodeRabbit, Gitar, Qodo all use LLMs to read the PR. The same kind of models that wrote the code. The same blind spots. They don't have access to your team's decisions either.",
    tone: 'muted',
  },
  {
    num: '3',
    title: 'TrueCourse is the only deterministic ground truth',
    body: "We turn your team's decisions into machine-readable contracts. Then a deterministic engine, no LLM, checks every change against them. Same input, same result, every time.",
    tone: 'accent',
  },
];

export function WhyTestsCantCatch() {
  return (
    <section
      id="why-tests-cant-catch"
      className="relative border-b border-border py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-4xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Why the existing tools can't catch this
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            <span className="text-gradient">
              Tests inherit the writer&apos;s understanding.
            </span>{' '}
            <span className="text-gradient-accent">
              AI reviewers inherit the writer&apos;s blind spots.
            </span>
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {CARDS.map((c, i) => (
            <Card key={c.num} {...c} delayMs={i * 100} />
          ))}
        </div>

        <p className="mt-12 text-balance text-base leading-relaxed text-foreground/85 sm:text-lg">
          Tests check code against what you wrote. AI review checks AI&apos;s code
          with more AI.{' '}
          <span className="text-foreground">
            We check code against what you actually decided.
          </span>
        </p>
      </div>
    </section>
  );
}

function Card({
  num,
  title,
  body,
  tone,
  delayMs,
}: {
  num: string;
  title: string;
  body: string;
  tone: Tone;
  delayMs: number;
}) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  const accent = tone === 'accent';
  return (
    <div
      ref={ref}
      style={{ ['--delay' as string]: `${delayMs}ms` }}
      className={cn(
        'reveal relative rounded-2xl border bg-card/40 p-6 transition-colors sm:p-7',
        accent
          ? 'border-accent/50 bg-accent/[0.04] hover:border-accent/70'
          : 'border-border hover:border-border-strong',
        visible && 'visible',
      )}
    >
      <div
        className={cn(
          'font-mono text-2xl font-semibold',
          accent ? 'text-accent' : 'text-muted-foreground',
        )}
      >
        {num}
      </div>
      <h3
        className={cn(
          'mt-4 text-balance text-lg font-semibold tracking-tight sm:text-xl',
          accent ? 'text-accent' : 'text-foreground',
        )}
      >
        {title}
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
        {body}
      </p>
    </div>
  );
}
