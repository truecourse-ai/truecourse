/**
 * The DETERMINISTIC pre-filter: archived / agent-instruction files,
 * changelogs, template dirs and
 * near-duplicate copies are dropped before any session is spent, and manual
 * includes bypass it. Only the entry point moved — the retired
 * `filterByRelevance` wrapped it; the scan run now calls `prefilterDocs` (for
 * the split) and `prefilterCategory` (for each drop's structured category)
 * directly, and `docs that reach the LLM` is now `docs that get a session`.
 */
import { describe, it, expect } from 'vitest';
import {
  isCarvedOutAgentSkill,
  prefilterCategory,
  prefilterDocs,
} from '../../packages/spec-consolidator/src/index.js';
import type { DocCandidate, RepoIdentity, SkipCategory } from '../../packages/spec-consolidator/src/index.js';

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

interface PrefilterView {
  /** The docs that would reach a `spec-scan.curate-doc` session. */
  sessioned: string[];
  skipped: Array<{ path: string; reason: string; category: SkipCategory | undefined }>;
}

/** The split exactly as the scan run computes it, categories included. */
function prefiltered(
  docs: DocCandidate[],
  opts: { manualIncludes?: string[]; identity?: RepoIdentity | null } = {},
): PrefilterView {
  const identity = opts.identity ?? null;
  const out = prefilterDocs(docs, opts.manualIncludes ?? [], identity);
  const byPath = new Map(docs.map((d) => [d.path, d]));
  return {
    sessioned: out.toClassify.map((d) => d.path),
    skipped: out.skipped.map((s) => ({
      path: s.path,
      reason: s.reason,
      category: prefilterCategory(byPath.get(s.path)!, identity),
    })),
  };
}

describe('the deterministic pre-filter', () => {
  it('drops archived dirs and agent-instruction files without a session', () => {
    const out = prefiltered([
      doc('docs/lead-engine-api-spec.md'),
      doc('archive/docs/old-prd.md'),
      doc('backend/services/CLAUDE.md'),
      doc('AGENTS.md'),
      doc('.github/copilot-instructions.md'),
    ]);
    expect(out.sessioned).toEqual(['docs/lead-engine-api-spec.md']);
    expect(out.skipped.map((s) => s.path).sort()).toEqual([
      '.github/copilot-instructions.md',
      'AGENTS.md',
      'archive/docs/old-prd.md',
      'backend/services/CLAUDE.md',
    ]);
    expect(out.skipped.find((s) => s.path === 'archive/docs/old-prd.md')!.reason).toMatch(/archive/i);
  });

  // Agent-instruction files are meta, never product spec — which flavour of
  // markdown they happen to use doesn't change that.
  it('drops agent-instruction files whatever their markdown extension', () => {
    const out = prefiltered([doc('CLAUDE.mdx'), doc('AGENTS.markdown'), doc('docs/real-spec.md')]);
    expect(out.sessioned).toEqual(['docs/real-spec.md']);
  });

  // The stem match must not widen the rule to arbitrary extensions: only
  // markdown is stripped, so a same-stem non-markdown file is untouched.
  it('does NOT treat a same-stem non-markdown file as agent-instruction meta', () => {
    expect(prefiltered([doc('prompt.txt')]).sessioned).toEqual(['prompt.txt']);
  });

  it('does NOT drop a file merely named like an archive segment', () => {
    // "old-pricing.md" is a filename, not a directory segment → keep.
    expect(prefiltered([doc('docs/old-pricing.md')]).sessioned).toEqual(['docs/old-pricing.md']);
  });

  it('manual include overrides a deterministic skip', () => {
    const out = prefiltered([doc('archive/keepme.md')], { manualIncludes: ['archive/keepme.md'] });
    expect(out.sessioned).toEqual(['archive/keepme.md']);
    expect(out.skipped).toEqual([]);
  });

  it('drops a near-duplicate (condensed copy), keeping the fuller doc', () => {
    const full = Array.from({ length: 20 }, (_, i) => `requirement ${i}: the system must behave a certain way`).join('\n');
    const condensed = Array.from({ length: 18 }, (_, i) => `requirement ${i}: the system must behave a certain way`).join('\n');
    const out = prefiltered([doc('docs/plan.md', full), doc('docs/plan-condensed.md', condensed)]);
    expect(out.sessioned).toEqual(['docs/plan.md']); // fuller kept
    expect(out.skipped.map((s) => s.path)).toEqual(['docs/plan-condensed.md']);
    expect(out.skipped[0].reason).toMatch(/near-duplicate/i);
  });

  it('does not dedup thin/stub docs (too few lines to judge)', () => {
    const out = prefiltered([doc('docs/a.md', 'one line'), doc('docs/b.md', 'one line')]);
    expect(out.sessioned.sort()).toEqual(['docs/a.md', 'docs/b.md']);
  });
});

// ---------------------------------------------------------------------------
// B8 — doc-class drops (agent-config trees, changelogs, template dirs).
// Deterministic, pre-session, with an F12 identity carve-out so the repo's OWN
// api-skill docs survive.
// ---------------------------------------------------------------------------

const CALCOM: RepoIdentity = { name: 'cal.com', aliases: ['cal.com', 'calcom'], sources: ['git-remote'] };

// A doc whose body is (almost) all version-bump lines — a pure changelog by
// content even though its NAME isn't `changelog`.
const versionBumpBody = Array.from(
  { length: 12 },
  (_, i) => `v1.${i}.0 - shipped feature ${i} and fixed bug ${i}`,
).join('\n');

describe('B8 doc-class drops', () => {
  const calcomApiDocs = [
    'agents/skills/calcom-api/auth.md',
    'agents/skills/calcom-api/bookings.md',
    'agents/skills/calcom-api/event-types.md',
    'agents/skills/calcom-api/availability.md',
    'agents/skills/calcom-api/webhooks.md',
    'agents/skills/calcom-api/schedules.md',
    'agents/skills/calcom-api/teams.md',
    'agents/skills/calcom-api/slots.md',
  ];

  it('keeps the 8 calcom-api skill docs and drops the agent/changelog/template classes with the right categories (no session spend on drops)', () => {
    const droppables = [
      doc('agents/rules/pr-review.md'),
      doc('agents/skills/commit-helper/SKILL.md'),
      doc('CHANGELOG.md'),
      doc('docs/whats-new.md', versionBumpBody),
      doc('docs/templates/adr.md'),
    ];
    const out = prefiltered([...calcomApiDocs.map((p) => doc(p)), ...droppables], { identity: CALCOM });

    // All 8 calcom-api docs survive (F12 pin) — via the carve-out.
    for (const p of calcomApiDocs) {
      expect(out.sessioned).toContain(p);
      expect(out.skipped.map((s) => s.path)).not.toContain(p);
    }

    const cat = (p: string): string | undefined => out.skipped.find((s) => s.path === p)?.category;
    expect(cat('agents/rules/pr-review.md')).toBe('agent-meta');
    expect(cat('agents/skills/commit-helper/SKILL.md')).toBe('agent-meta');
    expect(cat('CHANGELOG.md')).toBe('status-tracking');
    expect(cat('docs/whats-new.md')).toBe('status-tracking');
    expect(cat('docs/templates/adr.md')).toBe('process');

    // Only the kept calcom-api docs would be sessioned.
    expect(out.sessioned.sort()).toEqual([...calcomApiDocs].sort());
  });

  it('manualIncludes bypasses every new class drop', () => {
    const paths = ['agents/rules/pr-review.md', 'CHANGELOG.md', 'docs/templates/adr.md'];
    const out = prefiltered(paths.map((p) => doc(p)), { identity: CALCOM, manualIncludes: paths });
    expect(out.sessioned.sort()).toEqual([...paths].sort());
    expect(out.skipped).toEqual([]);
  });

  it('carve-out arm /api/: public-api survives, and calcom-api survives even with a NULL identity', () => {
    const out = prefiltered(
      [doc('agents/skills/public-api/reference.md'), doc('agents/skills/calcom-api/auth.md')],
      { identity: null },
    );
    expect(out.sessioned.sort()).toEqual([
      'agents/skills/calcom-api/auth.md',
      'agents/skills/public-api/reference.md',
    ]);
    expect(out.skipped).toEqual([]);
  });

  it('carve-out arm alias-core: a skill matching the repo identity survives only under that identity', () => {
    const p = 'agents/skills/calcom/overview.md';
    expect(prefiltered([doc(p)], { identity: CALCOM }).sessioned).toEqual([p]);

    const dropped = prefiltered([doc(p)], { identity: null });
    expect(dropped.sessioned).toEqual([]);
    expect(dropped.skipped.map((s) => s.path)).toEqual([p]);
    expect(dropped.skipped[0].category).toBe('agent-meta');
  });

  it('agents/rules never carves out even when it names the product', () => {
    // The carve-out is skills-only; a rules doc drops wholesale.
    const out = prefiltered([doc('agents/rules/calcom-api.md')], { identity: CALCOM });
    expect(out.sessioned).toEqual([]);
    expect(out.skipped[0].category).toBe('agent-meta');
  });

  it('does NOT drop a doc merely under a plain agents-less tree', () => {
    // `agents` must pair with a rules/skills/commands/prompts child; a bare
    // `docs/agents-overview.md` is a normal doc.
    expect(prefiltered([doc('docs/agents-overview.md')], { identity: CALCOM }).sessioned).toEqual([
      'docs/agents-overview.md',
    ]);
  });

  it('does NOT drop a doc that merely has a "## 1.2.0" heading (min-line floor)', () => {
    const body = '# Design\n## 1.2.0\nThe system exposes an endpoint that requires auth and validates its body.';
    expect(prefiltered([doc('docs/design.md', body)], { identity: CALCOM }).sessioned).toEqual([
      'docs/design.md',
    ]);
  });
});

describe('B8 review fixes', () => {
  // Fix 1: a carved-out skill path short-circuits EVERY class rule, not just the
  // agent rule. news.md would hit the changelog stem, and a templates/ subdir
  // would hit the template rule — the carve-out must win over both.
  it('a carved-out skill survives changelog-stem and template-dir rules', () => {
    const paths = [
      'agents/skills/calcom-api/news.md', // stem ∈ CHANGELOG_STEMS
      'agents/skills/calcom-api/history.md', // stem ∈ CHANGELOG_STEMS
      'agents/skills/calcom-api/templates/adr.md', // under a templates/ dir
    ];
    const out = prefiltered(paths.map((p) => doc(p)), { identity: CALCOM });
    expect(out.sessioned.sort()).toEqual([...paths].sort());
    expect(out.skipped).toEqual([]);
  });

  // Fix 2: a single-FILE skill leaf carries the markdown extension; strip it
  // before testing API_LEAF so `foo-api.md` is carved out (as the docstring
  // claims), while a non-api file leaf still drops.
  it('carves out a single-file api skill leaf under a null identity', () => {
    const out = prefiltered(
      [doc('agents/skills/foo-api.md'), doc('agents/skills/commit-helper.md')],
      { identity: null },
    );
    expect(out.sessioned).toEqual(['agents/skills/foo-api.md']);
    expect(out.skipped.map((s) => s.path)).toEqual(['agents/skills/commit-helper.md']);
    expect(out.skipped[0].category).toBe('agent-meta');
  });

  // Fix 3: ambiguous stems {news, history, changes} drop ONLY when the content
  // version-bump majority also confirms — an architecture-history doc survives,
  // a genuine version log drops.
  it('keeps an architecture-history doc but drops a version-log history.md', () => {
    const prose = Array.from(
      { length: 12 },
      (_, i) => `Decision ${i}: the service moved from a monolith toward isolated modules.`,
    ).join('\n');
    const out = prefiltered([doc('docs/history.md', prose), doc('notes/history.md', versionBumpBody)], {
      identity: CALCOM,
    });
    expect(out.sessioned).toEqual(['docs/history.md']);
    expect(out.skipped.map((s) => s.path)).toEqual(['notes/history.md']);
    expect(out.skipped[0].category).toBe('status-tracking');
  });

  // Fix 3: the strict stems still drop unconditionally by path.
  it('drops CHANGELOG.md by path even with no version-bump content', () => {
    const out = prefiltered(
      [doc('CHANGELOG.md', 'This file documents notable changes to the project over time.')],
      { identity: CALCOM },
    );
    expect(out.sessioned).toEqual([]);
    expect(out.skipped[0].category).toBe('status-tracking');
  });
});

describe('isCarvedOutAgentSkill (exported predicate)', () => {
  it('/api/ arm matches api-suffixed leaves regardless of identity', () => {
    expect(isCarvedOutAgentSkill('public-api', null)).toBe(true);
    expect(isCarvedOutAgentSkill('calcom-api', null)).toBe(true);
    expect(isCarvedOutAgentSkill('v2-api', null)).toBe(true);
    expect(isCarvedOutAgentSkill('apis', null)).toBe(true);
  });
  it('alias-core arm matches the repo product only under identity', () => {
    expect(isCarvedOutAgentSkill('calcom', CALCOM)).toBe(true);
    expect(isCarvedOutAgentSkill('calcom', null)).toBe(false);
  });
  it('a non-api, non-identity skill is not carved out', () => {
    expect(isCarvedOutAgentSkill('commit-helper', CALCOM)).toBe(false);
    expect(isCarvedOutAgentSkill('scheduling', CALCOM)).toBe(false);
  });
  it('strips a markdown extension off a single-file leaf before matching', () => {
    expect(isCarvedOutAgentSkill('foo-api.md', null)).toBe(true);
    expect(isCarvedOutAgentSkill('commit-helper.md', CALCOM)).toBe(false);
  });
});
