/**
 * A test told in PLAIN WORDS — the third way to read the one file behind a test:
 *
 *   View   the structured step list (what the engine will do, as rows)
 *   Story  this — the same file as sentences a non-author can review
 *   YAML   the bytes on disk
 *
 * The story answers "what does this test actually promise, and what world does it
 * promise it in?" without a reader learning the scenario format. It renders the
 * shared `describeGuardScenario` shape verbatim: nothing is composed here, so the
 * dashboard and `truecourse guard flows --show <id> --story` say the same words.
 *
 * The promise leads, the world comes next (a test that seeds files or fakes a
 * third party proves something different from one that does not), then the steps,
 * each as what it DOES, what it REMEMBERS, and what it ASSERTS.
 */

import type { GuardScenarioStory as Story } from '@truecourse/shared';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

/** One sentence in a list — the story's only body element. */
function Sentence({ children }: { children: React.ReactNode }) {
  return <li className="text-[12px] leading-relaxed text-muted-foreground">{children}</li>;
}

export function GuardScenarioStory({ story }: { story: Story }) {
  return (
    <div className="space-y-5" aria-label="scenario story">
      <div>
        <div className={LABEL}>The promise</div>
        <p className="text-[13px] leading-relaxed text-foreground">{story.promise ?? story.title}</p>
        {story.promise && story.promise !== story.title && (
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{story.title}</p>
        )}
      </div>

      {story.world.length > 0 && (
        <div>
          <div className={LABEL}>The world it runs in</div>
          <ul className="space-y-1">
            {story.world.map((line) => (
              <Sentence key={line}>{line}</Sentence>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className={LABEL}>What it does</div>
        <ol className="space-y-3">
          {story.steps.map((step) => (
            <li key={step.n} className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="w-4 shrink-0 text-[11px] text-muted-foreground">{step.n}</span>
                <span className="min-w-0 flex-1 break-words text-[13px] leading-snug text-foreground">
                  {step.does}
                  {step.repeat != null && (
                    <span className="text-muted-foreground"> — {step.repeat} times, every time</span>
                  )}
                </span>
              </div>
              <div className="space-y-1 pl-6 pt-1">
                {step.env && step.env.length > 0 && (
                  <p className="break-words font-mono text-[11px] text-muted-foreground">
                    with {step.env.join(' ')}
                  </p>
                )}
                {step.stdin !== undefined && (
                  <p className="break-words font-mono text-[11px] text-muted-foreground">
                    piping “{step.stdin}” to its input
                  </p>
                )}
                {step.uses && step.uses.length > 0 && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    using {step.uses.map((v) => `\`${v}\``).join(', ')} remembered earlier
                  </p>
                )}
                {step.captures && step.captures.length > 0 && (
                  <ul className="space-y-0.5">
                    {step.captures.map((c) => (
                      <li key={c} className="text-[11px] leading-relaxed text-muted-foreground">
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
                {step.expectations.length > 0 ? (
                  <ul className="space-y-0.5">
                    {step.expectations.map((e) => (
                      <li key={e} className="text-[12px] leading-relaxed text-foreground">
                        <span className="text-muted-foreground">must be true: </span>
                        {e}
                      </li>
                    ))}
                  </ul>
                ) : (
                  // A step with no assertion is preparation — saying so beats a
                  // silent gap where every sibling step has a "must be true".
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    asserts nothing — this step only prepares the world
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {story.normalizers.length > 0 && (
        <div>
          <div className={LABEL}>Before every comparison</div>
          <ul className="space-y-1">
            {story.normalizers.map((n) => (
              <Sentence key={n}>{n}</Sentence>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
