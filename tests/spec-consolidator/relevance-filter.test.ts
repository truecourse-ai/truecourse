/**
 * The relevance filter's `onProgress` callback drives the numbered
 * "Discovering docs · N/total" progress shown during a spec scan. It fires
 * an initial `(0, total)` so the UI learns the total upfront, then once per
 * doc as each classification resolves (concurrent, so by completion order).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetKvCacheStore } from '@truecourse/llm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  filterByRelevance,
  buildRelevanceUserPrompt,
  RELEVANCE_SYSTEM_PROMPT,
} from '../../packages/spec-consolidator/src/index.js';
import type {
  RelevanceRunner,
  DocCandidate,
  RepoIdentity,
} from '../../packages/spec-consolidator/src/index.js';

function doc(p: string): DocCandidate {
  return {
    path: p,
    absPath: `/abs/${p}`,
    kind: 'prd',
    preview: 'preview',
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: 100,
  };
}

let repo: string;
beforeEach(() => {
  // Stale verdicts leak between tests otherwise — the KV cache store is global.
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-relevance-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const includeAll: RelevanceRunner = async ({ doc }) => ({
  path: doc.path,
  include: true,
  reason: 'ok',
});

describe('filterByRelevance — onProgress', () => {
  it('reports an initial 0/total and ticks up to total/total', async () => {
    const docs = [doc('a.md'), doc('b.md'), doc('c.md')];
    const calls: Array<[number, number]> = [];

    const out = await filterByRelevance(repo, docs, {
      runner: includeAll,
      onProgress: (done, total) => calls.push([done, total]),
    });

    expect(out.included).toHaveLength(3);
    expect(calls[0]).toEqual([0, 3]); // initial, total known upfront
    expect(calls).toHaveLength(4); // initial + one per doc
    expect(calls[calls.length - 1]).toEqual([3, 3]);
    // done is monotonic non-decreasing; total is constant.
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
      expect(calls[i][1]).toBe(3);
    }
  });

  it('counts manual includes too (which skip the runner)', async () => {
    let runnerCalls = 0;
    const runner: RelevanceRunner = async ({ doc }) => {
      runnerCalls++;
      return { path: doc.path, include: true, reason: 'ok' };
    };
    const calls: Array<[number, number]> = [];

    await filterByRelevance(repo, [doc('keep.md')], {
      runner,
      manualIncludes: ['keep.md'],
      onProgress: (done, total) => calls.push([done, total]),
    });

    expect(runnerCalls).toBe(0); // manual include bypasses classification
    expect(calls[calls.length - 1]).toEqual([1, 1]); // still counted
  });

  it('does not fire onProgress when the filter is disabled', async () => {
    const calls: Array<[number, number]> = [];
    await filterByRelevance(repo, [doc('a.md')], {
      enabled: false,
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls).toHaveLength(0);
  });
});

/**
 * The classifier must SEE the doc's path (fixture/sample-tree specs describe a
 * fictional product and are not this repo's spec — the path is the signal the
 * content lacks). The path rides the user prompt; the system prompt teaches the
 * model to weigh it as evidence, not a blanket verdict.
 */
describe('filterByRelevance — path-aware relevance', () => {
  const fixturePath =
    'tests/fixtures/sample-js-project-il/reference/specs/modules/orders/data.md';

  it('puts the doc repo-relative path in the assembled user prompt', () => {
    const prompt = buildRelevanceUserPrompt(doc(fixturePath), null);
    expect(prompt).toContain(fixturePath);
    expect(prompt).toMatch(/PATH/); // clearly labeled field
  });

  it('system prompt is GENERAL — subject attribution, no layout or product vocabulary', () => {
    // The judgment is subject-first, decided against the identity block…
    expect(RELEVANCE_SYSTEM_PROMPT).toMatch(/STEP 1 — SUBJECT/);
    expect(RELEVANCE_SYSTEM_PROMPT).toMatch(/Quality is not evidence of ownership/);
    expect(RELEVANCE_SYSTEM_PROMPT).toMatch(/evidence/i); // path is evidence, never a verdict
    // …and carries no overfitted vocabulary: no repo-layout words, no product names.
    expect(RELEVANCE_SYSTEM_PROMPT).not.toMatch(/fixture|sample|test.?(data|tree)|truecourse/i);
  });

  it('drops a fixture-tree spec via a path-based verdict', async () => {
    // Stands in for the LLM: uses the PATH the same way the model is told to —
    // a fixture-tree spec describing a sample product is not this repo's spec.
    const runner: RelevanceRunner = async ({ doc }) => {
      const isFixtureTree = /(^|\/)(tests|fixtures|__fixtures__|examples)\//.test(doc.path);
      return isFixtureTree
        ? { path: doc.path, include: false, reason: `test-data spec for a sample product (${doc.path})` }
        : { path: doc.path, include: true, reason: 'describes this repository' };
    };
    const out = await filterByRelevance(repo, [doc('docs/orders-api.md'), doc(fixturePath)], {
      runner,
    });
    expect(out.included.map((d) => d.path)).toEqual(['docs/orders-api.md']);
    expect(out.skipped.map((s) => s.doc.path)).toEqual([fixturePath]);
    expect(out.skipped[0].reason).toMatch(/test-data|sample product/i);
  });
});

/**
 * F12 — the classifier had no repo self-identity. It was told to SKIP docs about
 * a "THIRD-PARTY / external system" but never told which product is ours, so it
 * had to infer "who are we" from the document alone. Every good API reference
 * names its own product, so a repo's own API docs read as a vendor's: cal.com
 * lost its entire v2 API reference, wekan 117 of 221 dropped docs. The identity
 * reaches the model as prompt DATA, and a deterministic net catches it when it
 * is wrong anyway.
 */
describe('filterByRelevance — repo self-identity', () => {
  const identity: RepoIdentity = {
    name: 'cal.com',
    description: 'Scheduling infrastructure',
    aliases: ['Cal.com', 'Cal.diy'],
    sources: ['git-remote'],
  };

  function docWith(p: string, content: string): DocCandidate {
    return { ...doc(p), content, preview: content.split('\n').slice(0, 5).join('\n'), absPath: '' };
  }

  it('states the repo identity in the assembled user prompt', () => {
    const prompt = buildRelevanceUserPrompt(doc('docs/api.md'), identity);
    expect(prompt).toMatch(/IDENTITY/);
    expect(prompt).toContain('cal.com');
    expect(prompt).toContain('Cal.diy');
  });

  it('leaves the prompt free of an identity block when there is no identity', () => {
    expect(buildRelevanceUserPrompt(doc('docs/api.md'), null)).not.toMatch(/IDENTITY/);
  });

  // The identity is per-run DATA, so it rides the user prompt; the system prompt
  // stays the rule set (a `const`, one fingerprint change ever). It must still
  // TEACH the model to read the block — otherwise the data has no effect.
  it('system prompt attributes the subject against the identity block', () => {
    expect(RELEVANCE_SYSTEM_PROMPT).toMatch(/IDENTITY/);
    expect(RELEVANCE_SYSTEM_PROMPT).toMatch(/different-product/);
    expect(RELEVANCE_SYSTEM_PROMPT).toMatch(/this-product/);
  });

  it('passes the identity through to the runner', async () => {
    let seen: RepoIdentity | null | undefined;
    await filterByRelevance(repo, [doc('docs/api.md')], {
      identity,
      runner: async (input) => {
        seen = input.identity;
        return { path: input.doc.path, include: true, reason: 'ok' };
      },
    });
    expect(seen).toEqual(identity);
  });

  // The named case from the handoff: a doc that reads exactly like public vendor
  // documentation, about our own product. A model that has the identity block
  // keeps it; one that doesn't calls it a vendor's.
  it('keeps a doc about our own product that reads like vendor documentation', async () => {
    const api = docWith('docs/api.md', '# Foo API\n\nThe Foo API authenticates with an API key.');
    const identityFoo: RepoIdentity = { name: 'foo', aliases: ['Foo'], sources: ['git-remote'] };
    // Stands in for the model: judges third-party by whether the product the doc
    // names is the one the IDENTITY block declares.
    const runner: RelevanceRunner = async ({ doc, identity }) => {
      const named = /the (\w+) API/i.exec(doc.content ?? '')?.[1]?.toLowerCase();
      const ours = [identity?.name, ...(identity?.aliases ?? [])].some(
        (a) => a?.toLowerCase() === named,
      );
      return ours
        ? { path: doc.path, include: true, reason: 'our own API reference' }
        : { path: doc.path, include: false, category: 'third-party', reason: `vendor API research (${named})` };
    };
    const out = await filterByRelevance(repo, [api], { identity: identityFoo, runner });
    expect(out.included.map((d) => d.path)).toEqual(['docs/api.md']);
  });
});

describe('filterByRelevance — third-party backstop', () => {
  const identity: RepoIdentity = { name: 'cal.com', aliases: ['Cal.com'], sources: ['git-remote'] };

  function docWith(p: string, content: string): DocCandidate {
    return { ...doc(p), content, preview: content.split('\n').slice(0, 5).join('\n'), absPath: '' };
  }

  const dropsAsThirdParty: RelevanceRunner = async ({ doc }) => ({
    path: doc.path,
    include: false,
    category: 'third-party',
    reason: "vendor API research (Cal.com's authentication API)",
  });

  it('re-includes a third-party drop whose prose names our own product', async () => {
    const d = docWith('docs/api.md', 'The Cal.com API authenticates with an API key.');
    const out = await filterByRelevance(repo, [d], { identity, runner: dropsAsThirdParty });

    expect(out.included.map((x) => x.path)).toEqual(['docs/api.md']);
    expect(out.skipped).toHaveLength(0);
    expect(out.reinstated).toHaveLength(1);
    expect(out.reinstated[0].originalReason).toMatch(/vendor API research/);
  });

  // Matching the RAW body would make this a re-include-everything switch: a
  // genuine Stripe vendor doc that imports `@calcom/lib` in a snippet, or an MDX
  // page wrapped in our own `<CalcomProvider>`, would come straight back.
  it('does not fire when our name appears only in code or markup', async () => {
    const fenced = docWith('docs/stripe.md', "Stripe billing notes.\n\n```ts\nimport '@calcom/lib';\n```");
    const jsx = docWith('docs/stripe.mdx', '<CalcomProvider>Stripe billing notes.</CalcomProvider>');
    const out = await filterByRelevance(repo, [fenced, jsx], { identity, runner: dropsAsThirdParty });

    expect(out.included).toHaveLength(0);
    expect(out.skipped.map((s) => s.doc.path).sort()).toEqual(['docs/stripe.md', 'docs/stripe.mdx']);
    expect(out.reinstated).toHaveLength(0);
  });

  it('leaves non-third-party drops alone', async () => {
    const d = docWith('docs/todo.md', 'Cal.com launch checklist.');
    const out = await filterByRelevance(repo, [d], {
      identity,
      runner: async ({ doc }) => ({
        path: doc.path,
        include: false,
        category: 'status-tracking',
        reason: 'TODO checklist',
      }),
    });
    expect(out.included).toHaveLength(0);
    expect(out.reinstated).toHaveLength(0);
  });

  // The backstop runs in the final assembly loop, AFTER the cache — not inside
  // `classifyOne`. Inside, it would fire only on fresh classifications and the
  // doc would vanish again on the very next (cached) run.
  it('fires on a cached verdict too, with no LLM call', async () => {
    const d = docWith('docs/api.md', 'The Cal.com API authenticates with an API key.');
    let calls = 0;
    const counting: RelevanceRunner = async (input) => {
      calls++;
      return dropsAsThirdParty(input);
    };

    const first = await filterByRelevance(repo, [d], { identity, runner: counting });
    expect(calls).toBe(1);
    expect(first.reinstated).toHaveLength(1);

    const second = await filterByRelevance(repo, [d], { identity, runner: counting });
    expect(calls).toBe(1); // cached — no second call
    expect(second.included.map((x) => x.path)).toEqual(['docs/api.md']);
    expect(second.reinstated).toHaveLength(1);
  });
});

describe('relevance cache — identity is part of the key', () => {
  it('misses when the identity changes, so a stale verdict cannot survive', async () => {
    const a: RepoIdentity = { name: 'foo', aliases: ['Foo'], sources: [] };
    const b: RepoIdentity = { name: 'bar', aliases: ['Barr'], sources: [] };
    let calls = 0;
    const runner: RelevanceRunner = async ({ doc }) => {
      calls++;
      return { path: doc.path, include: true, reason: 'ok' };
    };

    await filterByRelevance(repo, [doc('docs/api.md')], { identity: a, runner });
    expect(calls).toBe(1);
    await filterByRelevance(repo, [doc('docs/api.md')], { identity: a, runner });
    expect(calls).toBe(1); // same identity → hit
    await filterByRelevance(repo, [doc('docs/api.md')], { identity: b, runner });
    expect(calls).toBe(2); // different identity → miss
  });
});
