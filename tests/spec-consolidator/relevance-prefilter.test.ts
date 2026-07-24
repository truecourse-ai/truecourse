/**
 * Deterministic pre-filter in filterByRelevance: archived/agent-instruction
 * files and near-duplicate copies are dropped BEFORE any LLM call. Manual
 * includes bypass it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  filterByRelevance,
  isCarvedOutAgentSkill,
  RELEVANCE_SYSTEM_PROMPT,
} from '../../packages/spec-consolidator/src/index.js';
import type {
  RelevanceRunner,
  DocCandidate,
  RepoIdentity,
} from '../../packages/spec-consolidator/src/index.js';

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

  // Agent-instruction files are meta, never product spec — which flavour of
  // markdown they happen to use doesn't change that.
  it('drops agent-instruction files whatever their markdown extension', async () => {
    const out = await filterByRelevance(
      repo,
      [doc('CLAUDE.mdx'), doc('AGENTS.markdown'), doc('docs/real-spec.md')],
      { runner: trackingRunner },
    );
    expect(out.included.map((d) => d.path)).toEqual(['docs/real-spec.md']);
    expect(runnerCalls).toEqual(['docs/real-spec.md']);
  });

  // The stem match must not widen the rule to arbitrary extensions: only
  // markdown is stripped, so a same-stem non-markdown file is untouched.
  it('does NOT treat a same-stem non-markdown file as agent-instruction meta', async () => {
    const out = await filterByRelevance(repo, [doc('prompt.txt')], { runner: trackingRunner });
    expect(out.included.map((d) => d.path)).toEqual(['prompt.txt']);
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

// ---------------------------------------------------------------------------
// B8 — relevance-filter doc-class drops (agent-config trees, changelogs,
// template dirs). Deterministic, pre-LLM, with an F12 identity carve-out so the
// repo's OWN api-skill docs survive.
// ---------------------------------------------------------------------------

const CALCOM: RepoIdentity = { name: 'cal.com', aliases: ['cal.com', 'calcom'], sources: ['git-remote'] };

// A doc whose body is (almost) all version-bump lines — a pure changelog by
// content even though its NAME isn't `changelog`.
const versionBumpBody = Array.from(
  { length: 12 },
  (_, i) => `v1.${i}.0 - shipped feature ${i} and fixed bug ${i}`,
).join('\n');

describe('filterByRelevance — B8 doc-class drops', () => {
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

  it('keeps the 8 calcom-api skill docs and drops the agent/changelog/template classes with the right categories (no LLM spend on drops)', async () => {
    const droppables = [
      doc('agents/rules/pr-review.md'),
      doc('agents/skills/commit-helper/SKILL.md'),
      doc('CHANGELOG.md'),
      doc('docs/whats-new.md', versionBumpBody),
      doc('docs/templates/adr.md'),
    ];
    const out = await filterByRelevance(
      repo,
      [...calcomApiDocs.map((p) => doc(p)), ...droppables],
      { runner: trackingRunner, identity: CALCOM },
    );

    // All 8 calcom-api docs survive (F12 pin) — via the carve-out.
    for (const p of calcomApiDocs) {
      expect(out.included.map((d) => d.path)).toContain(p);
      expect(out.skipped.map((s) => s.doc.path)).not.toContain(p);
    }

    // Each droppable is skipped with the expected structured category.
    const cat = (p: string): string | undefined =>
      out.skipped.find((s) => s.doc.path === p)?.category;
    expect(cat('agents/rules/pr-review.md')).toBe('agent-meta');
    expect(cat('agents/skills/commit-helper/SKILL.md')).toBe('agent-meta');
    expect(cat('CHANGELOG.md')).toBe('status-tracking');
    expect(cat('docs/whats-new.md')).toBe('status-tracking');
    expect(cat('docs/templates/adr.md')).toBe('process');

    // No dropped doc — kept or dropped by class — reached the LLM runner. Only
    // the kept calcom-api docs did.
    expect(runnerCalls.sort()).toEqual([...calcomApiDocs].sort());
  });

  it('manualIncludes bypasses every new class drop', async () => {
    const out = await filterByRelevance(
      repo,
      [
        doc('agents/rules/pr-review.md'),
        doc('CHANGELOG.md'),
        doc('docs/templates/adr.md'),
      ],
      {
        runner: trackingRunner,
        identity: CALCOM,
        manualIncludes: ['agents/rules/pr-review.md', 'CHANGELOG.md', 'docs/templates/adr.md'],
      },
    );
    expect(out.included.map((d) => d.path).sort()).toEqual([
      'CHANGELOG.md',
      'agents/rules/pr-review.md',
      'docs/templates/adr.md',
    ]);
    expect(out.skipped).toEqual([]);
  });

  it('carve-out arm /api/: public-api survives, and calcom-api survives even with a NULL identity', async () => {
    const out = await filterByRelevance(
      repo,
      [
        doc('agents/skills/public-api/reference.md'),
        doc('agents/skills/calcom-api/auth.md'),
      ],
      { runner: trackingRunner, identity: null },
    );
    expect(out.included.map((d) => d.path).sort()).toEqual([
      'agents/skills/calcom-api/auth.md',
      'agents/skills/public-api/reference.md',
    ]);
    expect(out.skipped).toEqual([]);
  });

  it('carve-out arm alias-core: a skill matching the repo identity survives only under that identity', async () => {
    const p = 'agents/skills/calcom/overview.md';

    const keptUnderIdentity = await filterByRelevance(repo, [doc(p)], {
      runner: trackingRunner,
      identity: CALCOM,
    });
    expect(keptUnderIdentity.included.map((d) => d.path)).toEqual([p]);

    // Fresh repo to avoid a warm relevance cache from the previous call.
    const repo2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-prefilter2-'));
    try {
      const droppedNullIdentity = await filterByRelevance(repo2, [doc(p)], {
        runner: trackingRunner,
        identity: null,
      });
      expect(droppedNullIdentity.included).toEqual([]);
      expect(droppedNullIdentity.skipped.map((s) => s.doc.path)).toEqual([p]);
      expect(droppedNullIdentity.skipped[0].category).toBe('agent-meta');
    } finally {
      fs.rmSync(repo2, { recursive: true, force: true });
    }
  });

  it('agents/rules never carves out even when it names the product', async () => {
    // The carve-out is skills-only; a rules doc drops wholesale.
    const out = await filterByRelevance(repo, [doc('agents/rules/calcom-api.md')], {
      runner: trackingRunner,
      identity: CALCOM,
    });
    expect(out.included).toEqual([]);
    expect(out.skipped[0].category).toBe('agent-meta');
  });

  it('does NOT drop a doc merely under a plain agents-less tree', async () => {
    // `agents` must pair with a rules/skills/commands/prompts child; a bare
    // `docs/agents-overview.md` is a normal doc.
    const out = await filterByRelevance(repo, [doc('docs/agents-overview.md')], {
      runner: trackingRunner,
      identity: CALCOM,
    });
    expect(out.included.map((d) => d.path)).toEqual(['docs/agents-overview.md']);
    expect(runnerCalls).toEqual(['docs/agents-overview.md']);
  });

  it('does NOT drop a doc that merely has a "## 1.2.0" heading (min-line floor)', async () => {
    const body = '# Design\n## 1.2.0\nThe system exposes an endpoint that requires auth and validates its body.';
    const out = await filterByRelevance(repo, [doc('docs/design.md', body)], {
      runner: trackingRunner,
      identity: CALCOM,
    });
    expect(out.included.map((d) => d.path)).toEqual(['docs/design.md']);
  });
});

describe('filterByRelevance — B8 review fixes', () => {
  // Fix 1: a carved-out skill path short-circuits EVERY class rule, not just the
  // agent rule. news.md would hit the changelog stem, and a templates/ subdir
  // would hit the template rule — the carve-out must win over both.
  it('a carved-out skill survives changelog-stem and template-dir rules', async () => {
    const paths = [
      'agents/skills/calcom-api/news.md', // stem ∈ CHANGELOG_STEMS
      'agents/skills/calcom-api/history.md', // stem ∈ CHANGELOG_STEMS
      'agents/skills/calcom-api/templates/adr.md', // under a templates/ dir
    ];
    const out = await filterByRelevance(repo, paths.map((p) => doc(p)), {
      runner: trackingRunner,
      identity: CALCOM,
    });
    expect(out.included.map((d) => d.path).sort()).toEqual([...paths].sort());
    expect(out.skipped).toEqual([]);
  });

  // Fix 2: a single-FILE skill leaf carries the markdown extension; strip it
  // before testing API_LEAF so `foo-api.md` is carved out (as the docstring
  // claims), while a non-api file leaf still drops.
  it('carves out a single-file api skill leaf under a null identity', async () => {
    const out = await filterByRelevance(
      repo,
      [doc('agents/skills/foo-api.md'), doc('agents/skills/commit-helper.md')],
      { runner: trackingRunner, identity: null },
    );
    expect(out.included.map((d) => d.path)).toEqual(['agents/skills/foo-api.md']);
    expect(out.skipped.map((s) => s.doc.path)).toEqual(['agents/skills/commit-helper.md']);
    expect(out.skipped[0].category).toBe('agent-meta');
  });

  // Fix 3: ambiguous stems {news, history, changes} drop ONLY when the content
  // version-bump majority also confirms — an architecture-history doc survives,
  // a genuine version log drops.
  it('keeps an architecture-history doc but drops a version-log history.md', async () => {
    const prose = Array.from(
      { length: 12 },
      (_, i) => `Decision ${i}: the service moved from a monolith toward isolated modules.`,
    ).join('\n');
    const out = await filterByRelevance(
      repo,
      [doc('docs/history.md', prose), doc('notes/history.md', versionBumpBody)],
      { runner: trackingRunner, identity: CALCOM },
    );
    expect(out.included.map((d) => d.path)).toEqual(['docs/history.md']);
    expect(out.skipped.map((s) => s.doc.path)).toEqual(['notes/history.md']);
    expect(out.skipped[0].category).toBe('status-tracking');
  });

  // Fix 3: the strict stems still drop unconditionally by path.
  it('drops CHANGELOG.md by path even with no version-bump content', async () => {
    const out = await filterByRelevance(
      repo,
      [doc('CHANGELOG.md', 'This file documents notable changes to the project over time.')],
      { runner: trackingRunner, identity: CALCOM },
    );
    expect(out.included).toEqual([]);
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

describe('RELEVANCE_SYSTEM_PROMPT fingerprint is pinned (B8 must not move it)', () => {
  it('sha256/16 of the relevance system prompt is unchanged — no relevance-cache invalidation', () => {
    const fp = createHash('sha256').update(RELEVANCE_SYSTEM_PROMPT).digest('hex').slice(0, 16);
    expect(fp).toBe('c89d79aad411d38f');
  });
});
