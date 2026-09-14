/**
 * THE dialog stepper: one segment per step in a row, the ones already taken
 * green, the one being taken in the foreground colour, the ones ahead muted,
 * each named under its segment. No "Step 2 of 4": the row says where you are
 * and what is left at a glance.
 *
 * It renders as spans so it can live inside a dialog's description.
 */

export function Stepper({
  steps,
  /** Index of the step being taken, from 0. */
  current,
}: {
  steps: readonly string[];
  current: number;
}) {
  return (
    <span className="flex gap-1.5">
      {steps.map((name, index) => (
        <span
          key={name}
          {...(index === current ? { 'aria-current': 'step' as const } : {})}
          className="flex min-w-0 flex-1 flex-col gap-1"
        >
          <span
            aria-hidden
            className={`block h-1.5 w-full rounded-full ${
              index < current ? 'bg-emerald-500' : index === current ? 'bg-foreground' : 'bg-muted'
            }`}
          />
          <span
            className={`truncate text-[11px] ${index === current ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
          >
            {name}
          </span>
        </span>
      ))}
    </span>
  );
}
