import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';
import { Illustration } from './Illustration';

export function WhereWeFit() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <section
      id="where-we-fit"
      className="relative border-b border-border py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div
          ref={ref}
          className={cn('reveal mx-auto max-w-4xl text-center', visible && 'visible')}
        >
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Where we fit
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            <span className="text-gradient">In the PR.</span>{' '}
            <span className="text-gradient-accent">Before the human reviewer.</span>
          </h2>
        </div>

        <div className="mt-12 flex justify-center">
          <Illustration
            src="/illustrations/slide4-sdlc.png"
            alt="Pipeline diagram: code is written by a developer or AI, a PR opens, TrueCourse verify runs deterministically in seconds, a human reviewer makes the final judgement, then merge"
            className="w-full max-w-5xl"
          />
        </div>

        <p className="mx-auto mt-12 max-w-3xl text-balance text-center text-base leading-relaxed text-foreground/85 sm:text-lg">
          Every kind of drift surfaced. Mechanical, behavioral, architectural.
          Senior engineers make the final judgement with all the data, instead of
          hunting for it.
        </p>
      </div>
    </section>
  );
}
