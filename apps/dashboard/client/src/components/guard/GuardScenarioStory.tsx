/**
 * The plain-words STORY of a scenario — what it tests, read top to bottom without
 * decoding YAML matchers: *Doc says* (the claim + its section heading) → *Setup*
 * (seeded files) → *Run* (the argv) → *Expect* (each matcher as a sentence). The
 * mechanics-to-words translation is the shared `describeScenario` helper, so this
 * story never drifts from what the runner executes. A scenario with no stored claim
 * renders the story minus the claim line (no placeholder noise).
 */

import { useMemo } from 'react';
import { describeScenario, type GuardScenario } from '@truecourse/shared';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
const CODE = 'block overflow-x-auto whitespace-pre rounded border border-border bg-muted/20 px-2 py-1 font-mono text-[11px] text-foreground';

export function GuardScenarioStory({
  scenario,
  headingText,
}: {
  scenario: GuardScenario;
  /** The bound section's human heading — the "§ …" context under Doc says. */
  headingText?: string;
}) {
  const story = useMemo(() => describeScenario(scenario), [scenario]);
  const multiStep = story.steps.length > 1;

  return (
    <div className="space-y-3" aria-label="scenario story">
      {(story.claim || headingText) && (
        <div>
          <div className={LABEL}>Doc says</div>
          {story.claim && <p className="text-[13px] leading-relaxed text-foreground">{story.claim}</p>}
          {headingText && <div className="mt-0.5 break-all text-[11px] text-muted-foreground">§ {headingText}</div>}
        </div>
      )}

      {story.setupFiles.length > 0 && (
        <div>
          <div className={LABEL}>Setup</div>
          <ul className="space-y-0.5">
            {story.setupFiles.map((f) => (
              <li key={f} className="break-all font-mono text-[11px] text-muted-foreground">{f}</li>
            ))}
          </ul>
        </div>
      )}

      {story.steps.map((step, i) => (
        <div key={i}>
          <div className={LABEL}>{multiStep ? `Run · step ${i + 1}` : 'Run'}</div>
          <code className={CODE}>{step.command}</code>
          {step.stdin !== undefined && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              stdin: <span className="font-mono text-foreground">{step.stdin || '(empty)'}</span>
            </div>
          )}
          {step.repeat !== undefined && (
            <div className="mt-1 text-[11px] text-muted-foreground">repeated {step.repeat} times</div>
          )}
          <div className={`${LABEL} mt-2`}>Expect</div>
          {step.expectations.length > 0 ? (
            <ul className="space-y-0.5">
              {step.expectations.map((e, j) => (
                <li key={j} className="text-[12px] leading-relaxed text-foreground">{e}</li>
              ))}
            </ul>
          ) : (
            <div className="text-[11px] text-muted-foreground">nothing asserted</div>
          )}
        </div>
      ))}
    </div>
  );
}
