/**
 * A long block of DATA (a transcript, a program's output, a file's text) inside a
 * detail pane.
 *
 * A detail pane is the ONLY scroll context it has: nothing inside it scrolls on
 * its own. So a long block renders CLAMPED to a head and grows INLINE on one
 * click, the page scrolls, the block never does.
 */

import { useState } from 'react';

/** How many lines a clamped block shows before the expander. */
export const GUARD_CLAMP_LINES = 24;

/**
 * Long DATA wraps, a value with no newlines must read in place, never behind a
 * horizontal scrollbar. Indentation-sensitive artifacts (the raw YAML view) keep
 * the unwrapped ARTIFACT_PRE instead.
 */
const WRAPPED_PRE =
  'mt-1 max-w-full whitespace-pre-wrap break-words rounded border border-border bg-muted/20 p-2 font-mono text-[11px] text-foreground';

export function GuardLongText({
  text,
  label,
  head = GUARD_CLAMP_LINES,
}: {
  text: string;
  /** Accessible name of the block, how tests and readers address it. */
  label: string;
  head?: number;
}) {
  const [open, setOpen] = useState(false);
  const lines = text.split('\n');
  const clamped = !open && lines.length > head;
  return (
    <div>
      <pre className={WRAPPED_PRE} aria-label={label}>
        {clamped ? lines.slice(0, head).join('\n') : text}
      </pre>
      {lines.length > head && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-[11px] text-primary hover:underline"
        >
          {open ? 'Collapse' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}
