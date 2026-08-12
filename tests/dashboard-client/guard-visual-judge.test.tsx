/**
 * THE SCREEN-READING CHIP — what a vision model made of the screenshot a failing
 * web step left behind, worn beside the failure.
 *
 * The verdict never moves a status: the deterministic expectation alone decided
 * the step, and the chip answers the reader's first question instead — "so what
 * was actually on the screen?". Its colour follows the incumbent fault rule the
 * triage chip set:
 *
 *   looks present  sky — the red may be the assertion's own fault (a brittle
 *                  locator or matcher), which is a different next action than a
 *                  real drift, and a different colour than either red or muted
 *                  (the guard palette bans amber; blue is its news-not-blame
 *                  colour, the same remap that took BLOCKED);
 *   looks absent   muted — the model merely corroborates the red the status
 *                  already wears, and a second red would read as a second fact;
 *   looks unclear  muted — an honest shrug; a model forced to guess would add
 *                  exactly the confident noise this annotation must not.
 *
 * Where the chip APPEARS beside a real failure — and where the judge's reading
 * appears inside the failing step's inspector — is covered with the rest of the
 * test detail in `guard-tests.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GuardVisualAnswer } from '@truecourse/shared';
import { GuardVisualChip, GUARD_VISUAL_WORD } from '@/components/guard/GuardVisualChip';

const chipFor = (verdict: GuardVisualAnswer): string => {
  const { unmount } = render(
    <GuardVisualChip
      visual={{ verdict, summary: 'The heading reads “FILTERED BY: CATEGORY”.' }}
    />,
  );
  const className = screen.getByText(GUARD_VISUAL_WORD[verdict]).className;
  unmount();
  return className;
};

describe('GuardVisualChip — what the screenshot looked like, beside the failure', () => {
  it('says it in plain words that carry the epistemics — "looks", never "is"', () => {
    expect(GUARD_VISUAL_WORD).toEqual({
      yes: 'looks present',
      no: 'looks absent',
      unclear: 'looks unclear',
    });
  });

  it('wears sky for the test-is-wrong signal and muted otherwise — never red', () => {
    // `yes` is THE signal: the page may be fine and the assertion brittle.
    expect(chipFor('yes')).toMatch(/sky/);
    // `no` corroborates the failure; `unclear` declines to answer. Neither is
    // news the status colour has not already told.
    expect(chipFor('no')).toContain('text-muted-foreground');
    expect(chipFor('unclear')).toContain('text-muted-foreground');
    // A model's reading never paints "the repo is broken" red — that colour
    // belongs to measured drift alone. And the guard palette bans amber/orange
    // outright (the sweep in guard-vocabulary.test.tsx enforces it).
    for (const verdict of ['yes', 'no', 'unclear'] as const)
      expect(chipFor(verdict)).not.toMatch(/red|amber|orange/);
  });
});
