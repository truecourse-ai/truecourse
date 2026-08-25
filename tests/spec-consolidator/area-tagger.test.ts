/**
 * The deterministic half of the area tagger, AFTER the move to sessions (plan
 * 02 step 3): `tagDocs` — the one-shot stage — is retired, and its judgment now
 * belongs to the `spec-scan.curate-doc` session (see
 * `tests/core/spec-scan-curate.test.ts`, which carries the per-doc cache, the
 * fail-open-to-empty-tags degradation, and the status precedence).
 *
 * What stays here is `parseDocStatus` / `classifyStatusValue`: the header
 * parse the FOLD still runs as the backstop behind every session verdict.
 */
import { describe, it, expect } from 'vitest';
import { classifyStatusValue, parseDocStatus } from '../../packages/spec-consolidator/src/index.js';

describe('parseDocStatus', () => {
  it('reads a canonical Status line', () => {
    expect(parseDocStatus('# Title\nStatus: shipped\n')).toBe('shipped');
  });
  it('maps common phrasings to canonical statuses', () => {
    expect(parseDocStatus('Status: Done')).toBe('shipped');
    expect(parseDocStatus('Status: Draft')).toBe('planned');
    expect(parseDocStatus('Status: Deprecated')).toBe('deprecated');
    expect(parseDocStatus('**Status:** Out of scope')).toBe('out-of-scope');
  });
  it('handles bulleted / bold frontmatter forms', () => {
    expect(parseDocStatus('- **Status**: planned')).toBe('planned');
  });
  it('returns undefined when no status is stated', () => {
    expect(parseDocStatus('# Title\njust prose\n')).toBeUndefined();
  });
  it('only scans the header window', () => {
    const body = ['# Title', ...Array(60).fill('filler'), 'Status: shipped'].join('\n');
    expect(parseDocStatus(body)).toBeUndefined();
  });
  it('does not let incidental shipped-words override a governing planned/terminal state', () => {
    expect(parseDocStatus('Status: planned, will go live in Q4')).toBe('planned');
    expect(parseDocStatus('Status: draft, targeting GA in Q3')).toBe('planned');
    expect(parseDocStatus('Status: completed, now deprecated')).toBe('deprecated');
  });
  it('keeps scanning past an unrecognized status line to a clearer one', () => {
    expect(parseDocStatus('Status: ![badge](https://x/y.svg)\nStatus: shipped\n')).toBe('shipped');
  });
});

describe('classifyStatusValue — what the session\'s free-form `status` is read as', () => {
  it('canonicalizes the phrasings a session may report', () => {
    expect(classifyStatusValue('shipped')).toBe('shipped');
    expect(classifyStatusValue('Done')).toBe('shipped');
    expect(classifyStatusValue('draft')).toBe('planned');
    expect(classifyStatusValue('Out of scope')).toBe('out-of-scope');
  });
  it('returns undefined for a value that names no lifecycle, so the header parse decides', () => {
    expect(classifyStatusValue('purple')).toBeUndefined();
    expect(classifyStatusValue('')).toBeUndefined();
  });
});
