/**
 * THE dialog stepper: the steps' NAMES in one line under the title, the one
 * being taken at full contrast, the ones already taken muted behind a check,
 * the ones ahead muted. No "Step 2 of 4", no bar — a name says where you are
 * and what is left, which a number cannot.
 *
 * It renders as spans so it can live inside a dialog's description.
 */

import { Check } from 'lucide-react';

export function Stepper({
  steps,
  /** Index of the step being taken, from 0. */
  current,
}: {
  steps: readonly string[];
  current: number;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      {steps.map((name, index) => (
        <span
          key={name}
          {...(index === current ? { 'aria-current': 'step' as const } : {})}
          className="inline-flex items-center gap-1"
        >
          {index < current && <Check className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
          <span className={index === current ? 'font-medium text-foreground' : 'text-muted-foreground'}>
            {name}
          </span>
        </span>
      ))}
    </span>
  );
}
