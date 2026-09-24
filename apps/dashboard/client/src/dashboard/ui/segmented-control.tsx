/**
 * One choice out of a few, as a segmented control: one track, the chosen
 * option raised inside it. A radio group to assistive technology; the arrow
 * keys (and Home / End) move the choice, and only the chosen option sits in
 * the tab order.
 */

import { useRef, type KeyboardEvent } from 'react';

export interface SegmentedOption<K extends string> {
  key: K;
  label: string;
}

export function SegmentedControl<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** The group's accessible name, `Period`. */
  label: string;
  options: readonly SegmentedOption<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((o) => o.key === value));

  const move = (to: number) => {
    const index = (to + options.length) % options.length;
    refs.current[index]?.focus();
    if (options[index]!.key !== value) onChange(options[index]!.key);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step: Record<string, number | undefined> = {
      ArrowRight: current + 1,
      ArrowDown: current + 1,
      ArrowLeft: current - 1,
      ArrowUp: current - 1,
      Home: 0,
      End: options.length - 1,
    };
    const to = step[e.key];
    if (to === undefined) return;
    e.preventDefault();
    move(to);
  };

  return (
    <span
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5 dark:bg-background dark:ring-1 dark:ring-inset dark:ring-border"
    >
      {options.map((option, i) => {
        const on = i === current;
        return (
          <button
            key={option.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(option.key)}
            onKeyDown={onKeyDown}
            className={`rounded-[5px] px-2 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              on
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-muted'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </span>
  );
}
