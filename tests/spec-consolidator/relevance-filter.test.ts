/**
 * The relevance filter AFTER the move to sessions:
 * `filterByRelevance` — the one-shot stage, its runner seam, its progress
 * callback and its per-doc cache — is retired. The judgment now belongs to the
 * `spec-scan.curate-doc` session, and the pieces that decided what to do with a
 * verdict stayed here, as pure functions the FOLD calls:
 *
 *   - `applySubjectAttribution` — a `different-product` subject decides the doc,
 *     whatever the model then said about `keep`;
 *   - `namesOurProduct` + `aliasMatcher` — the deterministic backstop that
 *     reinstates a third-party drop whose PROSE names our own product.
 *
 * The pipeline-level versions of these (a session verdict folding to a
 * third-party skip, the backstop firing on a CACHED verdict, the identity in
 * the cache key, the prompt's own rules) live in
 * `tests/core/spec-scan-curate.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  aliasMatcher,
  applySubjectAttribution,
  namesOurProduct,
} from '../../packages/spec-consolidator/src/index.js';
import type { DocCandidate, RelevanceVerdict } from '../../packages/spec-consolidator/src/index.js';

function docWith(p: string, content: string): DocCandidate {
  return {
    path: p,
    absPath: '',
    content,
    kind: 'prd',
    preview: content.split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

/**
 * F12 — the classifier had no repo self-identity, so a repo's own API docs read
 * as a vendor's (cal.com lost its entire v2 API reference). The identity reaches
 * the model as briefing DATA; attribution then decides the doc deterministically.
 */
describe('applySubjectAttribution', () => {
  const verdict = (over: Partial<RelevanceVerdict>): RelevanceVerdict => ({
    path: 'docs/api.md',
    include: true,
    reason: 'reads like a real spec',
    ...over,
  });

  it('a different-product subject drops the doc as third-party, whatever it claimed', () => {
    expect(applySubjectAttribution(verdict({ subject: 'different-product' }))).toMatchObject({
      include: false,
      category: 'third-party',
    });
  });

  it('leaves this-product and unknown verdicts exactly as they came', () => {
    for (const subject of ['this-product', 'unknown'] as const) {
      const v = verdict({ subject });
      expect(applySubjectAttribution(v)).toEqual(v);
    }
    const skipped = verdict({ subject: 'this-product', include: false, category: 'status-tracking' });
    expect(applySubjectAttribution(skipped)).toEqual(skipped);
  });
});

/**
 * The third-party backstop's matcher. Matching the RAW body would make it a
 * re-include-everything switch: a genuine Stripe vendor doc that imports
 * `@calcom/lib` in a snippet, or an MDX page wrapped in our own
 * `<CalcomProvider>`, would come straight back.
 */
describe('namesOurProduct — prose only, never code or markup', () => {
  const ours = aliasMatcher(['Cal.com']);

  it('fires when the PROSE names our product', () => {
    expect(namesOurProduct(docWith('docs/api.md', 'The Cal.com API authenticates with an API key.'), ours)).toBe(
      true,
    );
  });

  it('does not fire on a fenced code block or on JSX markup', () => {
    expect(
      namesOurProduct(
        docWith('docs/stripe.md', "Stripe billing notes.\n\n```ts\nimport '@calcom/lib';\n```"),
        ours,
      ),
    ).toBe(false);
    expect(
      namesOurProduct(
        docWith('docs/stripe.mdx', '<CalcomProvider>Stripe billing notes.</CalcomProvider>'),
        ours,
      ),
    ).toBe(false);
  });

  it('a doc that never names us is never reinstated', () => {
    expect(namesOurProduct(docWith('docs/vendor.md', 'ServiceTitan dispatches jobs.'), ours)).toBe(false);
  });
});
