import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';
import { Illustration } from './Illustration';

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative border-b border-border py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Top half */}
        <TopHalf />

        {/* Bottom half — two minimalist sub-cards */}
        <div className="mt-24 grid grid-cols-1 gap-16 md:grid-cols-2 md:gap-12">
          <StepCard
            number="1"
            title="Decisions compile into contracts"
            body="Every decision compiles into a machine-readable contract. Versioned, reviewable, lives alongside your code."
            illustration={
              <Illustration
                src="/illustrations/slide5-contracts.png"
                alt="Verified knowledge base compiling into machine-readable contracts"
                className="w-full"
              />
            }
            delayMs={0}
          />
          <StepCard
            number="2"
            title="A deterministic model checks the code"
            body="Our verifier walks the codebase and checks every contract. No LLM in the loop. Same input, same result, every time."
            illustration={
              <Illustration
                src="/illustrations/slide5-verifier.png"
                alt="Deterministic verifier checking code against contracts and producing a drift report"
                className="w-full"
              />
            }
            delayMs={120}
          />
        </div>

        {/* Punchline */}
        <p className="mt-20 text-balance text-center text-lg text-foreground/90 sm:text-xl">
          <span className="text-gradient-accent font-medium">
            Audit-ready by design.
          </span>{' '}
          <span className="text-muted-foreground">
            No black box, no AI guesswork in the verification loop.
          </span>
        </p>
      </div>
    </section>
  );
}

function TopHalf() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cn('reveal mx-auto max-w-5xl text-center', visible && 'visible')}
    >
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
        What TrueCourse does
      </p>
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
        <span className="text-gradient">Your decisions compile into contracts.</span>
        <br />
        <span className="text-gradient-accent">
          A deterministic model checks the code against them.
        </span>
      </h2>

      <div className="mt-12 flex justify-center">
        <Illustration
          src="/illustrations/slide4-verify.png"
          alt="TrueCourse verification engine: knowledge base and codebase feeding into the verifier, producing drift report, AI guardrails, and audit log"
          className="w-full max-w-4xl"
        />
      </div>
    </div>
  );
}

function StepCard({
  number,
  title,
  body,
  illustration,
  delayMs,
}: {
  number: string;
  title: string;
  body: string;
  illustration: React.ReactNode;
  delayMs: number;
}) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ ['--delay' as string]: `${delayMs}ms` }}
      className={cn('reveal flex flex-col', visible && 'visible')}
    >
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-2xl font-semibold text-accent">{number}</span>
        <h3 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">
          {title}
        </h3>
      </div>
      <div className="mt-6 flex flex-1 items-center justify-center">{illustration}</div>
      <p className="mt-6 text-base leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
