/**
 * The pure comparison behind a pull request check: one delta per flow from the
 * base's and the head's flow summaries, the conflicts a head creates beyond
 * the workspace's own, and the documents a head moved under the flows bound to
 * them.
 */
import { describe, it, expect } from 'vitest';
import type { GuardManifest } from '@truecourse/shared';
import {
  compareFlows,
  conflictsCreated,
  docsMoved,
} from '../../packages/core/src/services/pr-check/compare';
import { buildCorpusConflicts, sentenceKey } from '../../packages/shared/src/spec/conflict-resolution';

describe('compareFlows', () => {
  it.each([
    ['succeeded', 'failed', 'new-failure'],
    ['blocked', 'failed', 'new-failure'],
    ['never-run', 'failed', 'new-failure'],
    [null, 'failed', 'new-failure'],
    ['failed', 'failed', 'pre-existing'],
    ['failed', 'succeeded', 'fixed'],
    // A failure that merely stopped running proves nothing.
    ['failed', 'blocked', 'unchanged'],
    ['failed', 'never-run', 'unchanged'],
    ['failed', 'not-testable', 'unchanged'],
    ['succeeded', 'blocked', 'newly-blocked'],
    ['blocked', 'blocked', 'unchanged'],
    ['succeeded', 'succeeded', 'unchanged'],
    // Partially succeeded is proven: a renamed control moves nothing, and it counts wherever succeeded does.
    ['succeeded', 'partially-succeeded', 'unchanged'],
    ['failed', 'partially-succeeded', 'fixed'],
    ['partially-succeeded', 'blocked', 'newly-blocked'],
    ['blocked', 'partially-succeeded', 'newly-covered'],
    ['partially-succeeded', 'failed', 'new-failure'],
    // Coverage the head gained: a flow that could not run, or had no scenario, now passes.
    ['never-run', 'succeeded', 'newly-covered'],
    ['blocked', 'succeeded', 'newly-covered'],
    ['not-testable', 'succeeded', 'unchanged'],
    [null, 'succeeded', 'added'],
    [null, 'blocked', 'added'],
    ['succeeded', null, 'retired'],
    ['failed', null, 'retired'],
  ] as const)('base %s, head %s → %s', (base, head, kind) => {
    const deltas = compareFlows(base ? { f: base } : {}, head ? { f: head } : {});
    expect(deltas).toEqual([{ flowId: 'f', kind, base, head }]);
  });

  it('lists every flow either run knew, in id order', () => {
    expect(
      compareFlows({ b: 'succeeded', a: 'failed' }, { c: 'succeeded', a: 'failed' }).map((d) => [d.flowId, d.kind]),
    ).toEqual([
      ['a', 'pre-existing'],
      ['b', 'retired'],
      ['c', 'added'],
    ]);
  });
});

describe('conflictsCreated', () => {
  /** A conflict between one sentence of each doc, named after the heading it sits under. */
  const conflict = (a: string, b: string, headingA: string, headingB: string) => ({
    docs: [a, b] as [string, string],
    note: `${a} vs ${b}`,
    sections: [
      { doc: a, heading: headingA, quote: `${headingA} says x`, sentence: sentenceKey(`${headingA} says x`) },
      { doc: b, heading: headingB, quote: `${headingB} says y`, sentence: sentenceKey(`${headingB} says y`) },
    ],
  });
  const corpus = (...conflicts: ReturnType<typeof conflict>[]) => ({ areas: [{ id: 'core/auth', conflicts }] });

  it('keeps only the head’s open conflicts the workspace does not already carry, by conflict identity', () => {
    const shared = conflict('a.md', 'b.md', 'Login', 'Sessions');
    const fresh = conflict('a.md', 'c.md', 'Login', 'Tokens');
    const prConflicts = buildCorpusConflicts(corpus(shared, fresh), {}).filter((c) => !c.resolved);
    // The workspace's copy of the shared conflict windows the quotes differently,
    // files the sentences under other headings and lists the docs the other way
    // round: same identity all the same.
    const workspace = corpus({
      ...conflict('b.md', 'a.md', 'Sessions', 'Login'),
      sections: [
        { doc: 'b.md', heading: 'Session cookies', quote: 'other words', sentence: sentenceKey('Sessions says y') },
        { doc: 'a.md', heading: 'Signing in', quote: 'more words', sentence: sentenceKey('Login says x') },
      ],
    });
    expect(conflictsCreated(workspace, prConflicts, {}).map((c) => c.b)).toEqual(['c.md']);
  });

  it('a conflict the workspace resolved is created anew when the head states it in other sentences', () => {
    const decisions = {
      conflictResolutions: [
        { docA: 'a.md', anchorA: 'Login', sentenceA: sentenceKey('Login says x'), docB: 'b.md', anchorB: 'Sessions', sentenceB: sentenceKey('Sessions says y'), verdict: 'a' as const },
      ],
    };
    const workspace = corpus(conflict('a.md', 'b.md', 'Login', 'Sessions'));
    // The head reworded one side of the disagreement: a new identity, which
    // the old verdict does not cover.
    const head = corpus(conflict('a.md', 'b.md', 'Login', 'Cookies'));
    const prConflicts = buildCorpusConflicts(head, decisions).filter((c) => !c.resolved);
    expect(prConflicts).toHaveLength(1);
    expect(conflictsCreated(workspace, prConflicts, decisions)).toHaveLength(1);
    // The same sentences as the workspace's, resolved there: not open, not created.
    const same = buildCorpusConflicts(workspace, decisions).filter((c) => !c.resolved);
    expect(conflictsCreated(workspace, same, decisions)).toEqual([]);
  });

  it('a new disagreement between two sections the workspace already conflicts on another point is created', () => {
    const between = (quoteA: string, quoteB: string) => ({
      docs: ['a.md', 'b.md'] as [string, string],
      note: `${quoteA} vs ${quoteB}`,
      sections: [
        { doc: 'a.md', heading: 'Login', quote: quoteA, sentence: sentenceKey(quoteA) },
        { doc: 'b.md', heading: 'Sessions', quote: quoteB, sentence: sentenceKey(quoteB) },
      ],
    });
    const ttl = between('Tokens last an hour.', 'Tokens last a day.');
    const lockout = between('Five failures lock the account.', 'Accounts never lock.');
    const prConflicts = buildCorpusConflicts(corpus(ttl, lockout), {});
    expect(conflictsCreated(corpus(ttl), prConflicts, {}).map((c) => c.note)).toEqual([lockout.note]);
  });

  it('treats no workspace corpus as carrying nothing', () => {
    const prConflicts = buildCorpusConflicts(corpus(conflict('a.md', 'b.md', 'L', 'S')), {});
    expect(conflictsCreated(null, prConflicts, {})).toHaveLength(1);
  });
});

describe('docsMoved', () => {
  /** A manifest whose flows bind `[doc, ...sentence texts]` per binding. */
  const manifest = (flows: Array<{ id: string; bindings: Array<[string, ...string[]]> }>): GuardManifest => ({
    flows: flows.map((f) => ({
      flowId: f.id,
      flowFingerprint: 'fp',
      bindings: f.bindings.map(([doc, ...texts]) => ({ doc, sentences: texts.map((t) => sentenceKey(t)) })),
      scenarios: [],
      interfaces: [],
      generationInputsHash: null,
      gaps: [],
      retiredScenarios: [],
    })),
  });

  it('names the documents where a head flow binds sentences the base never bound there, with every such flow', () => {
    const base = manifest([
      { id: 'f1', bindings: [['docs/a.md', 'Log in with a password.'], ['docs/c.md', 'Log out anywhere.']] },
      // A base flow that binds the document at other sentences: the head's set
      // is one the base held, so nothing moved by the order flows come in.
      { id: 'f0', bindings: [['docs/c.md', 'Sessions last a day.']] },
      { id: 'f2', bindings: [['docs/a.md', 'Log in with a password.']] },
    ]);
    const head = manifest([
      { id: 'f1', bindings: [['docs/a.md', 'Log in with a passkey.'], ['docs/c.md', 'Log out anywhere.']] },
      { id: 'f2', bindings: [['docs/a.md', 'Log in with a passkey.']] },
      { id: 'f4', bindings: [['docs/c.md', 'Sessions last a day.']] },
      // A document the base never bound is new, not moved.
      { id: 'f3', bindings: [['docs/b.md', 'Welcome.']] },
    ]);
    expect(docsMoved(base, head)).toEqual([{ doc: 'docs/a.md', flowIds: ['f1', 'f2'] }]);
  });

  it('answers nothing without both manifests', () => {
    expect(docsMoved(null, manifest([{ id: 'f', bindings: [['d', 'x']] }]))).toEqual([]);
    expect(docsMoved(manifest([{ id: 'f', bindings: [['d', 'x']] }]), null)).toEqual([]);
  });
});
