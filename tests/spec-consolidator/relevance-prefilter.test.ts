/**
 * Deterministic pre-filter in filterByRelevance: archived/agent-instruction
 * files and near-duplicate copies are dropped BEFORE any LLM call. Manual
 * includes bypass it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filterByRelevance } from '../../packages/spec-consolidator/src/index.js';
import type { RelevanceRunner, DocCandidate } from '../../packages/spec-consolidator/src/index.js';

function doc(p: string, content?: string): DocCandidate {
  return {
    path: p,
    absPath: '', // empty → docBody uses `content` (or preview), no disk read
    content,
    kind: 'prd',
    preview: (content ?? 'preview').split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: (content ?? '').length || 100,
  };
}

let repo: string;
let runnerCalls: string[];
const trackingRunner: RelevanceRunner = async ({ doc }) => {
  runnerCalls.push(doc.path);
  return { path: doc.path, include: true, reason: 'ok' };
};

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-prefilter-'));
  runnerCalls = [];
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('filterByRelevance — deterministic pre-filter', () => {
  it('drops archived dirs and agent-instruction files without an LLM call', async () => {
    const out = await filterByRelevance(
      repo,
      [
        doc('docs/lead-engine-api-spec.md'),
        doc('archive/docs/old-prd.md'),
        doc('backend/services/CLAUDE.md'),
        doc('AGENTS.md'),
        doc('.github/copilot-instructions.md'),
      ],
      { runner: trackingRunner },
    );
    expect(out.included.map((d) => d.path)).toEqual(['docs/lead-engine-api-spec.md']);
    expect(out.skipped.map((s) => s.path ?? s.doc.path).sort()).toEqual([
      '.github/copilot-instructions.md',
      'AGENTS.md',
      'archive/docs/old-prd.md',
      'backend/services/CLAUDE.md',
    ]);
    // only the real spec doc reached the LLM
    expect(runnerCalls).toEqual(['docs/lead-engine-api-spec.md']);
    expect(out.skipped.find((s) => s.doc.path === 'archive/docs/old-prd.md')!.reason).toMatch(/archive/i);
  });

  it('does NOT drop a file merely named like an archive segment', async () => {
    // "old-pricing.md" is a filename, not a directory segment → keep.
    const out = await filterByRelevance(repo, [doc('docs/old-pricing.md')], { runner: trackingRunner });
    expect(out.included.map((d) => d.path)).toEqual(['docs/old-pricing.md']);
    expect(runnerCalls).toEqual(['docs/old-pricing.md']);
  });

  it('manual include overrides a deterministic skip', async () => {
    const out = await filterByRelevance(repo, [doc('archive/keepme.md')], {
      runner: trackingRunner,
      manualIncludes: ['archive/keepme.md'],
    });
    expect(out.included.map((d) => d.path)).toEqual(['archive/keepme.md']);
  });

  it('drops a near-duplicate (condensed copy), keeping the fuller doc', async () => {
    const full = Array.from({ length: 20 }, (_, i) => `requirement ${i}: the system must behave a certain way`).join('\n');
    const condensed = Array.from({ length: 18 }, (_, i) => `requirement ${i}: the system must behave a certain way`).join('\n');
    const out = await filterByRelevance(
      repo,
      [doc('docs/plan.md', full), doc('docs/plan-condensed.md', condensed)],
      { runner: trackingRunner },
    );
    expect(out.included.map((d) => d.path)).toEqual(['docs/plan.md']); // fuller kept
    expect(out.skipped.map((s) => s.doc.path)).toEqual(['docs/plan-condensed.md']);
    expect(out.skipped[0].reason).toMatch(/near-duplicate/i);
    expect(runnerCalls).toEqual(['docs/plan.md']); // condensed never hit the LLM
  });

  it('does not dedup thin/stub docs (too few lines to judge)', async () => {
    const out = await filterByRelevance(
      repo,
      [doc('docs/a.md', 'one line'), doc('docs/b.md', 'one line')],
      { runner: trackingRunner },
    );
    expect(out.included.map((d) => d.path).sort()).toEqual(['docs/a.md', 'docs/b.md']);
  });
});
