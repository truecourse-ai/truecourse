/**
 * The failing run's RAW program output (Fix 1) — head-truncated stdout/stderr
 * excerpts that ride on a guard failure/finding so the reader sees the usage error
 * the program actually printed, beneath the EXPECTED/ACTUAL panes. Renders nothing
 * when neither stream is present (empty streams are omitted upstream), so callers
 * can drop it in unconditionally. Same mono code-block idiom as the surrounding
 * expected/actual panes.
 */

import type { OutputExcerpts } from '@truecourse/shared';
import { PRE } from './detail-styles';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

export function GuardProgramOutput({ stdout, stderr }: OutputExcerpts) {
  if (!stdout && !stderr) return null;
  return (
    <div className="mt-2">
      <div className={LABEL}>Program output</div>
      {stdout && (
        <div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">stdout</span>
          <pre className={PRE} aria-label="program stdout">
            {stdout}
          </pre>
        </div>
      )}
      {stderr && (
        <div className="mt-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">stderr</span>
          <pre className={PRE} aria-label="program stderr">
            {stderr}
          </pre>
        </div>
      )}
    </div>
  );
}
