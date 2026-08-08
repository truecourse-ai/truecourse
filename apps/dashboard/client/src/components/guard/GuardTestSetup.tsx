/**
 * The world a test STARTS in — the scenario's `setup:` block, read above its
 * steps. The steps say what the test DOES; this says what was already true when
 * the first one ran, which is otherwise only visible by opening the YAML.
 *
 * Three kinds of starting fact, each a section of one card and each present only
 * when the file declares it: the SEEDED FILES (path as the toggle, content one
 * click away — a seed can be a whole config file, and a wall of them would bury
 * the steps below), the GIT world as one line per fact, and the ENV overlay.
 *
 * A file's content is long data, so it goes through the same block as every other
 * long value on the page ({@link GuardLongText}): clamped vertically, scrolled
 * horizontally, never re-wrapped.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GuardScenarioSetupView } from '@truecourse/shared';
import { GuardLongText } from './GuardLongText';

/** A section heading inside the card — the same bar the step groups are headed with. */
const SECTION = 'bg-muted/40 px-3 py-1.5 text-[11px] font-medium leading-snug text-foreground';
const CODE = 'rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground break-all';

/** One seeded file: the path is the row, its content is the disclosure. */
function SetupFile({ path, content }: { path: string; content: string }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${path}`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
      >
        <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-foreground">{path}</span>
      </button>
      {open && (
        <div className="min-w-0 pb-2 pl-8 pr-3">
          <GuardLongText text={content} label={`${path} contents`} />
        </div>
      )}
    </li>
  );
}

export function GuardTestSetup({ setup }: { setup: GuardScenarioSetupView }) {
  return (
    <div aria-label="test setup" className="min-w-0 rounded border border-border">
      {setup.files && setup.files.length > 0 && (
        <div className="border-b border-border last:border-b-0">
          <div className={SECTION}>Files</div>
          <ul>
            {setup.files.map((file) => (
              <SetupFile key={file.path} path={file.path} content={file.content} />
            ))}
          </ul>
        </div>
      )}
      {setup.git && setup.git.length > 0 && (
        <div className="border-b border-border last:border-b-0">
          <div className={SECTION}>Git</div>
          <ul className="px-3 py-2">
            {setup.git.map((line) => (
              <li key={line} className="break-words text-[12px] leading-relaxed text-foreground">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      {setup.env && setup.env.length > 0 && (
        <div className="border-b border-border last:border-b-0">
          <div className={SECTION}>Env</div>
          <div className="flex flex-wrap gap-1 px-3 py-2">
            {setup.env.map((pair) => (
              <code key={pair} className={CODE}>
                {pair}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
