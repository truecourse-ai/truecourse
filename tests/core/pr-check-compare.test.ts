/**
 * The pure comparison behind a pull request check: one delta per flow from the
 * base's and the head's flow summaries, the conflicts a head creates beyond
 * the workspace's own, and the sections a head moved with the flows bound to
 * them.
 */
import { describe, it, expect } from 'vitest';
import type { GuardManifest } from '@truecourse/shared';
import {
  compareFlows,
  conflictsCreated,
  sectionsMoved,
} from '../../packages/core/src/services/pr-check/compare';
import { buildCorpusConflicts } from '../../packages/shared/src/spec/overlap-resolution';

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
    ['never-run', 'succeeded', 'unchanged'],
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
  const dispute = (a: string, b: string, headingA: string | null, headingB: string | null) => ({
    docs: [a, b] as [string, string],
    note: `${a} vs ${b}`,
    sections: [
      { doc: a, heading: headingA, quote: 'x' },
      { doc: b, heading: headingB, quote: 'y' },
    ],
  });
  const corpus = (...overlaps: ReturnType<typeof dispute>[]) => ({ areas: [{ id: 'core/auth', overlaps }] });

  it('keeps only the head’s open conflicts the workspace does not already carry, by dispute identity', () => {
    const shared = dispute('a.md', 'b.md', 'Login', 'Sessions');
    const fresh = dispute('a.md', 'c.md', 'Login', 'Tokens');
    const prConflicts = buildCorpusConflicts(corpus(shared, fresh), {}).filter((c) => !c.resolved);
    // The workspace's copy of the shared dispute quotes it differently and
    // lists the docs the other way round: same identity all the same.
    const workspace = corpus({
      ...dispute('b.md', 'a.md', 'Sessions', 'Login'),
      sections: [
        { doc: 'b.md', heading: 'Sessions', quote: 'other words' },
        { doc: 'a.md', heading: 'Login', quote: 'more words' },
      ],
    });
    expect(conflictsCreated(workspace, prConflicts, {}).map((c) => c.b)).toEqual(['c.md']);
  });

  it('a dispute the workspace resolved is created anew when the head flags it under other anchors', () => {
    const decisions = {
      conflictResolutions: [
        { docA: 'a.md', anchorA: 'Login', docB: 'b.md', anchorB: 'Sessions', verdict: 'a' as const },
      ],
    };
    const workspace = corpus(dispute('a.md', 'b.md', 'Login', 'Sessions'));
    // The head moved the disagreement into another section: a new identity,
    // which the old verdict does not cover.
    const head = corpus(dispute('a.md', 'b.md', 'Login', 'Cookies'));
    const prConflicts = buildCorpusConflicts(head, decisions).filter((c) => !c.resolved);
    expect(prConflicts).toHaveLength(1);
    expect(conflictsCreated(workspace, prConflicts, decisions)).toHaveLength(1);
    // The same anchors as the workspace's, resolved there: not open, not created.
    const same = buildCorpusConflicts(workspace, decisions).filter((c) => !c.resolved);
    expect(conflictsCreated(workspace, same, decisions)).toEqual([]);
  });

  it('treats no workspace corpus as carrying nothing', () => {
    const prConflicts = buildCorpusConflicts(corpus(dispute('a.md', 'b.md', 'L', 'S')), {});
    expect(conflictsCreated(null, prConflicts, {})).toHaveLength(1);
  });
});

describe('sectionsMoved', () => {
  const manifest = (flows: Array<{ id: string; bindings: Array<[string, string, string]> }>): GuardManifest =>
    ({
      flows: flows.map((f) => ({
        flowId: f.id,
        flowFingerprint: 'fp',
        bindings: f.bindings.map(([doc, anchor, fingerprint]) => ({ doc, anchor, fingerprint })),
        scenarios: [],
        interfaces: [],
        generationInputsHash: null,
      })),
    }) as unknown as GuardManifest;

  it('names the sections whose fingerprint moved, with every flow bound to each', () => {
    const base = manifest([
      { id: 'f1', bindings: [['docs/a.md', 'login', 'sha:1'], ['docs/a.md', 'logout', 'sha:2']] },
      // A base flow that still binds the section at an older fingerprint: the
      // head's is one the base held, so nothing moved by the order flows come in.
      { id: 'f0', bindings: [['docs/a.md', 'logout', 'sha:9']] },
      { id: 'f2', bindings: [['docs/a.md', 'login', 'sha:1']] },
    ]);
    const head = manifest([
      { id: 'f1', bindings: [['docs/a.md', 'login', 'sha:9'], ['docs/a.md', 'logout', 'sha:2']] },
      { id: 'f2', bindings: [['docs/a.md', 'login', 'sha:9']] },
      // A section the base never bound is new, not moved.
      { id: 'f3', bindings: [['docs/b.md', 'intro', 'sha:5']] },
    ]);
    expect(sectionsMoved(base, head)).toEqual([{ doc: 'docs/a.md', anchor: 'login', flowIds: ['f1', 'f2'] }]);
  });

  it('answers nothing without both manifests', () => {
    expect(sectionsMoved(null, manifest([{ id: 'f', bindings: [['d', 'a', 'x']] }]))).toEqual([]);
    expect(sectionsMoved(manifest([{ id: 'f', bindings: [['d', 'a', 'x']] }]), null)).toEqual([]);
  });
});
