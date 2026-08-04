/**
 * Overlap flagging examines within-area doc pairs and surfaces the disagreements
 * for the user. Every pair is judged — nothing is capped or dropped (the
 * pre-flight cost estimate is the only spend gate) — and verdicts cache per pair.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  flagOverlaps,
  buildOverlapUserPrompt,
  OVERLAP_WINDOW_CHARS,
} from '../../packages/spec-consolidator/src/index.js';
import type {
  Area,
  DocCandidate,
  OverlapRunner,
  OverlapRunnerInput,
} from '../../packages/spec-consolidator/src/index.js';
import { planDocChunks } from '@truecourse/shared';

function doc(p: string, content = `body of ${p}`): DocCandidate {
  return {
    path: p,
    absPath: `/abs/${p}`,
    content,
    kind: 'prd',
    preview: content.split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

function area(id: string, refs: string[]): Area {
  const slash = id.indexOf('/');
  return {
    id,
    product: id.slice(0, slash),
    concern: id.slice(slash + 1),
    docRefs: refs,
    overlaps: [],
  };
}

const flagAll: OverlapRunner = async ({ a, b }) => ({ overlap: true, note: `${a.path} vs ${b.path}` });

// A realistic API-conventions area with 13 docs — each a short standard covering
// one facet of the platform's HTTP surface. 13 docs yield 13*12/2 = 78 within-area
// pairs, so the suite can prove every pair is judged.
const API_CONVENTION_DOCS: Array<{ path: string; content: string }> = [
  {
    path: 'docs/api/authentication.md',
    content:
      '# Authentication\n\nAll endpoints require a Bearer JWT in the `Authorization` header. Tokens are issued by the auth service and expire after 1 hour.\n',
  },
  {
    path: 'docs/api/authorization.md',
    content:
      '# Authorization\n\nAccess is scoped by role claims embedded in the JWT. A missing scope returns `403 Forbidden` with an `insufficient_scope` error code.\n',
  },
  {
    path: 'docs/api/errors.md',
    content:
      '# Error Envelope\n\nErrors return `{ code, message, details }`. The `code` is a stable machine-readable string; `message` is human-readable and may change.\n',
  },
  {
    path: 'docs/api/pagination.md',
    content:
      '# Pagination\n\nList endpoints use cursor-based pagination. Pass `?cursor=` and `?limit=` (default 25, max 100). The response carries `next_cursor` when more pages remain.\n',
  },
  {
    path: 'docs/api/rate-limiting.md',
    content:
      '# Rate Limiting\n\nClients are limited to 600 requests per minute per API key. Over the limit returns `429 Too Many Requests` with a `Retry-After` header in seconds.\n',
  },
  {
    path: 'docs/api/idempotency.md',
    content:
      '# Idempotency\n\nWrite endpoints accept an `Idempotency-Key` header. Keys are retained for 24 hours; a replayed key returns the original response without re-executing the write.\n',
  },
  {
    path: 'docs/api/versioning.md',
    content:
      '# Versioning\n\nThe API is versioned in the path (`/v1/...`). Breaking changes ship under a new major version; additive fields do not bump the version.\n',
  },
  {
    path: 'docs/api/timestamps.md',
    content:
      '# Timestamps\n\nAll timestamps are RFC 3339 UTC strings ending in `Z`. Duration fields are expressed as integer seconds unless the field name ends in `_ms`.\n',
  },
  {
    path: 'docs/api/webhooks.md',
    content:
      '# Webhooks\n\nEvents are delivered as signed POSTs. The `X-Signature` header carries an HMAC-SHA256 of the raw body. Delivery retries use exponential backoff for up to 24 hours.\n',
  },
  {
    path: 'docs/api/status-codes.md',
    content:
      '# Status Codes\n\n`2xx` for success, `4xx` for client faults, `5xx` for server faults. Validation failures return `422 Unprocessable Entity` with per-field details.\n',
  },
  {
    path: 'docs/api/content-negotiation.md',
    content:
      '# Content Negotiation\n\nRequests and responses are `application/json`. The server ignores an unsupported `Accept` header and always returns JSON.\n',
  },
  {
    path: 'docs/api/filtering.md',
    content:
      '# Filtering & Sorting\n\nList endpoints accept `?filter[field]=value` and `?sort=field` (prefix `-` for descending). Unknown filter fields return `400 Bad Request`.\n',
  },
  {
    path: 'docs/api/field-selection.md',
    content:
      '# Field Selection\n\nClients may request a subset of fields with `?fields=a,b,c`. Nested fields use dot notation. An empty or omitted `fields` returns the full resource.\n',
  },
];

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-overlap-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('flagOverlaps', () => {
  it('flags a disagreeing pair', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], docs, { runner: flagAll });
    expect(out.get('core/auth')).toEqual([{ docs: ['a.md', 'b.md'], note: 'a.md vs b.md', sections: [], areas: ['core/auth'] }]);
  });

  it('carries the conflicting sections the runner reports', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const runner: OverlapRunner = async ({ a, b }) => ({
      overlap: true,
      note: 'window differs',
      sections: [
        { doc: a.path, heading: 'Cancellation' },
        { doc: b.path, heading: 'Refunds' },
      ],
    });
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], docs, { runner });
    expect(out.get('core/auth')?.[0].sections).toEqual([
      { doc: 'a.md', heading: 'Cancellation' },
      { doc: 'b.md', heading: 'Refunds' },
    ]);
  });

  it('carries a preamble section pointer (null heading) through the cache round-trip', async () => {
    const docs = [doc('README.md'), doc('docs/PLAN.md')];
    const runner: OverlapRunner = async ({ a, b }) => ({
      overlap: true,
      note: 'README preamble lists C#; PLAN omits it',
      sections: [
        { doc: a.path, heading: null },
        { doc: b.path, heading: 'Tech Stack' },
      ],
    });
    const out = await flagOverlaps(repo, [area('core/languages', ['README.md', 'docs/PLAN.md'])], docs, { runner });
    expect(out.get('core/languages')?.[0].sections).toEqual([
      { doc: 'README.md', heading: null },
      { doc: 'docs/PLAN.md', heading: 'Tech Stack' },
    ]);
  });

  it('the default LLM runner maps a null-heading (preamble) side into the verdict', async () => {
    const docs = [doc('README.md'), doc('docs/PLAN.md')];
    // Side A sits in the preamble → heading null; side B is under a heading.
    const transport = async (): Promise<string> =>
      JSON.stringify({
        overlap: true,
        note: 'README preamble lists C#; PLAN omits it',
        sections: [
          { side: 'A', heading: null },
          { side: 'B', heading: 'Tech Stack' },
        ],
      });
    const out = await flagOverlaps(repo, [area('core/languages', ['README.md', 'docs/PLAN.md'])], docs, { transport });
    const sections = out.get('core/languages')?.[0].sections;
    expect(sections).toContainEqual({ doc: 'README.md', heading: null });
    expect(sections).toContainEqual({ doc: 'docs/PLAN.md', heading: 'Tech Stack' });
  });

  it('does not flag complementary docs', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const runner: OverlapRunner = async () => ({ overlap: false, note: '' });
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], docs, { runner });
    expect(out.size).toBe(0);
  });

  it('a relation-covered pair is STILL examined and flagged — relations never skip a pair', async () => {
    // The docs textually disagree; a replace relation is lifecycle metadata and
    // must not hide the disagreement from detection.
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], [doc('a.md'), doc('b.md')], {
      runner,
    });
    expect(calls).toBe(1);
    expect(out.get('core/auth')).toHaveLength(1);
  });

  it('dedups the same disagreement flagged across shared areas', async () => {
    // One doc pair co-occurs in two areas and the runner flags it in both with
    // identical sections — one real disagreement. It collapses to the
    // lexicographically-first area so the user sees a single conflict.
    const docs = [doc('a.md'), doc('b.md')];
    const areas = [area('booking/appointments', ['a.md', 'b.md']), area('booking/auth', ['a.md', 'b.md'])];
    const runner: OverlapRunner = async ({ a, b }) => ({
      overlap: true,
      note: 'cancellation window differs',
      sections: [
        { doc: a.path, heading: 'Core domain' },
        { doc: b.path, heading: 'Key flows' },
      ],
    });
    const out = await flagOverlaps(repo, areas, docs, { runner });
    expect(out.has('booking/appointments')).toBe(true); // first area keeps it
    expect(out.has('booking/auth')).toBe(false); // duplicate dropped
    expect(out.get('booking/appointments')).toHaveLength(1);
  });

  it('dedups the taskline shape — a shared pointer on ONE side, different pointers on the other', async () => {
    // The live bug: README + SPEC's `rm` dispute flagged in two shared areas. The
    // SPEC side points at the SAME heading in both; the README side differs (a
    // heading in one area, the preamble/null in the other). A shared pointer on
    // ONE side is enough — one dispute, one record, spanning both areas.
    const docs = [doc('README.md'), doc('docs/SPEC.md')];
    const areas = [
      area('core/persistence', ['README.md', 'docs/SPEC.md']),
      area('core/tasks-entity', ['README.md', 'docs/SPEC.md']),
    ];
    const runner: OverlapRunner = async ({ areaId, a, b }) => ({
      overlap: true,
      note: `rm dispute (${areaId})`,
      sections: [
        { doc: a.path, heading: areaId === 'core/persistence' ? 'taskline' : null },
        { doc: b.path, heading: 'rm <id>' },
      ],
    });
    const out = await flagOverlaps(repo, areas, docs, { runner });
    // One record, under the representative (fewest-null) area = persistence.
    expect(out.get('core/persistence')).toHaveLength(1);
    expect(out.has('core/tasks-entity')).toBe(false);
    // It records the full span so a resolution scoped to either area clears it.
    expect(out.get('core/persistence')![0].areas).toEqual(['core/persistence', 'core/tasks-entity']);
    // The surviving record is the more bandable side (a named README heading, no null).
    expect(out.get('core/persistence')![0].sections).toContainEqual({ doc: 'README.md', heading: 'taskline' });
  });

  it('keeps distinct conflicts between the same pair (different sections)', async () => {
    // The same pair disagrees on DIFFERENT sections in each area — two genuinely
    // different disagreements, so neither is deduped away.
    const docs = [doc('a.md'), doc('b.md')];
    const areas = [area('svc/x', ['a.md', 'b.md']), area('svc/y', ['a.md', 'b.md'])];
    const runner: OverlapRunner = async ({ areaId, a }) => ({
      overlap: true,
      note: `differs in ${areaId}`,
      sections: [{ doc: a.path, heading: areaId === 'svc/x' ? 'Auth' : 'Billing' }],
    });
    const out = await flagOverlaps(repo, areas, docs, { runner });
    expect(out.has('svc/x')).toBe(true);
    expect(out.has('svc/y')).toBe(true);
  });

  it('judges every within-area pair even past the old 60-pair cap', async () => {
    // 13 docs → 13*12/2 = 78 within-area pairs. Nothing is capped or dropped:
    // the runner is called once per pair.
    const refs = API_CONVENTION_DOCS.map((d) => d.path);
    const docs = API_CONVENTION_DOCS.map((d) => doc(d.path, d.content));
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return { overlap: false, note: '' };
    };
    await flagOverlaps(repo, [area('core/api-conventions', refs)], docs, { runner });
    expect(calls).toBe((refs.length * (refs.length - 1)) / 2);
    expect(calls).toBe(78);
  });

  it('caches verdicts per pair', async () => {
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const docs = [doc('a.md'), doc('b.md')];
    const areas = [area('core/auth', ['a.md', 'b.md'])];
    await flagOverlaps(repo, areas, docs, { runner });
    await flagOverlaps(repo, areas, docs, { runner });
    expect(calls).toBe(1);
  });

  it('does nothing when disabled', async () => {
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], [doc('a.md'), doc('b.md')], {
      runner,
      enabled: false,
    });
    expect(out.size).toBe(0);
    expect(calls).toBe(0);
  });

  it('ignores single-doc areas (no pairs)', async () => {
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md'])], [doc('a.md')], { runner: flagAll });
    expect(out.size).toBe(0);
  });
});

// The closed choice set: the user prompt enumerates each doc's actual section
// headings (a closed list) with a lead option first, so the small model SELECTS
// a pointer instead of recalling one; each side also copies a verbatim quote.
// The prompt/schema roll invalidates the overlap cache once (accepted).
describe('buildOverlapUserPrompt — headings enumerated as a closed choice set', () => {
  it('lists each doc\'s section options with a lead option first', () => {
    const a = doc('a.md', '# App A\n\nintro line\n\n## Auth\ndetails\n\n## Errors\nmore\n');
    const b = doc('b.md', '# App B\n\n## Storage\nstuff\n');
    const prompt = buildOverlapUserPrompt('core/auth', a, b);
    expect(prompt).toContain('SECTION OPTIONS');
    // A lead option appears for each side and maps to a null heading.
    expect(prompt.match(/use heading: null/g)?.length).toBe(2);
    // Doc A's real headings are enumerated as the closed set.
    expect(prompt).toContain('- App A');
    expect(prompt).toContain('- Auth');
    expect(prompt).toContain('- Errors');
    // Doc B's heading too, under its own list.
    expect(prompt).toContain('- Storage');
  });
});

describe('flagOverlaps — verbatim quotes persisted, quote-less cache entries still read', () => {
  const DOC_A =
    '# App A\n\n## Auth\nLogin requires a Bearer JWT in the Authorization header.\n\n## Errors\nErrors use a standard envelope.\n';
  const DOC_B = '# App B\n\n## Storage\nState lives in a JSON file on disk.\n';

  it('the default LLM runner carries each side\'s verbatim quote into the corpus', async () => {
    const docs = [doc('a.md', DOC_A), doc('b.md', DOC_B)];
    const transport = async (): Promise<string> =>
      JSON.stringify({
        overlap: true,
        note: 'a.md and b.md disagree on where auth state is kept',
        sections: [
          { side: 'A', heading: 'Auth', quote: 'Login requires a Bearer JWT' },
          { side: 'B', heading: 'Storage', quote: 'State lives in a JSON file' },
        ],
      });
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], docs, { transport });
    const sections = out.get('core/auth')?.[0].sections;
    // Both quotes are located in their pointed sections → pointers kept, quotes persisted.
    expect(sections).toContainEqual({ doc: 'a.md', heading: 'Auth', quote: 'Login requires a Bearer JWT' });
    expect(sections).toContainEqual({ doc: 'b.md', heading: 'Storage', quote: 'State lives in a JSON file' });
  });

  it('reads back an old cached verdict WITHOUT quotes (optional schema) and flows it through', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const areas = [area('core/auth', ['a.md', 'b.md'])];
    let calls = 0;
    // First run writes the older, quote-less verdict shape to the cache.
    const runner: OverlapRunner = async ({ a, b }) => {
      calls++;
      return { overlap: true, note: `${a.path} vs ${b.path}`, sections: [{ doc: a.path, heading: 'Legacy' }] };
    };
    await flagOverlaps(repo, areas, docs, { runner });
    // Second run hits the cache; OverlapVerdictSchema parses the quote-less entry.
    const second = await flagOverlaps(repo, areas, docs, { runner });
    expect(calls).toBe(1); // cache hit, not re-run
    expect(second.get('core/auth')?.[0].sections).toEqual([{ doc: 'a.md', heading: 'Legacy' }]);
  });
});

// Realistic fixtures: a broad platform PRD whose sections each state real
// behavior, and a focused pagination standard note. The tagger (upstream) files
// them under different concerns, so they never share an area — heading widening
// is what re-couples the pagination sections so the overlap judge sees the pair.
const BROAD_PRD = `# Payments Platform PRD
Status: shipped

## Authentication
All endpoints require a Bearer JWT in the Authorization header.

## Errors
Errors use the standard envelope { code, message, details }.

## Pagination
List endpoints use offset/limit paging with a default page size of 25.

## Idempotency
Write endpoints accept an Idempotency-Key header, retained for 24h.
`;

const PAGINATION_NOTE = `# Pagination Standard

## Pagination
All list endpoints MUST use cursor-based pagination with a default page size of 50.
`;

describe('flagOverlaps — heading-widened cross-area candidates', () => {
  it('pairs an outside doc whose heading matches the area concern with the area docs', async () => {
    const prd = doc('docs/platform-prd.md', BROAD_PRD);
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const seen: Array<[string, string, string]> = [];
    const runner: OverlapRunner = async ({ areaId, a, b }) => {
      seen.push([areaId, a.path, b.path]);
      return { overlap: true, note: `${a.path} vs ${b.path}` };
    };
    // PRD tagged api-conventions (umbrella), note tagged pagination — they never
    // co-locate. Neither area has two docs, so only widening can produce a pair.
    const areas = [
      area('core/api-conventions', ['docs/platform-prd.md']),
      area('core/pagination', ['docs/pagination.md']),
    ];
    const out = await flagOverlaps(repo, areas, [prd, note], { runner });

    // Exactly one widened pair, examined under the pagination area.
    expect(seen).toEqual([['core/pagination', 'docs/platform-prd.md', 'docs/pagination.md']]);
    expect(out.get('core/pagination')).toEqual([
      {
        docs: ['docs/platform-prd.md', 'docs/pagination.md'],
        note: 'docs/platform-prd.md vs docs/pagination.md',
        sections: [],
        areas: ['core/pagination'],
      },
    ]);
    // The umbrella area itself has no matching outside heading → no pair.
    expect(out.has('core/api-conventions')).toBe(false);
  });

  it('folds heading synonyms through the alias map (an "Authentication" heading matches the auth concern)', async () => {
    const prd = doc('docs/platform-prd.md', BROAD_PRD); // carries a "## Authentication" heading
    const authAdr = doc('docs/auth-adr.md', '# Bearer JWT ADR\n\n## Auth\nWe use Bearer JWTs.\n');
    const seen: string[] = [];
    const runner: OverlapRunner = async ({ a, b }) => {
      seen.push([a.path, b.path].sort().join(' vs '));
      return { overlap: false, note: '' };
    };
    const areas = [area('core/auth', ['docs/auth-adr.md'])];
    await flagOverlaps(repo, areas, [prd, authAdr], { runner });
    // "Authentication" → auth via the alias map, so the PRD widens into core/auth.
    expect(seen).toEqual(['docs/auth-adr.md vs docs/platform-prd.md']);
  });

  it('examines a widened pair even when a relation covers it — relations never skip', async () => {
    const prd = doc('docs/platform-prd.md', BROAD_PRD);
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('core/pagination', ['docs/pagination.md'])], [prd, note], {
      runner,
    });
    expect(calls).toBe(1);
    expect(out.get('core/pagination')).toHaveLength(1);
  });

  it('judges every widened pair — no cap drops one', async () => {
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const prd1 = doc('docs/prd-1.md', BROAD_PRD);
    const prd2 = doc('docs/prd-2.md', BROAD_PRD);
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('core/pagination', ['docs/pagination.md'])], [note, prd1, prd2], {
      runner,
    });
    // Two widened pairs (prd-1,note) + (prd-2,note) — both examined, none dropped.
    expect(calls).toBe(2);
    expect(out.get('core/pagination')).toHaveLength(2);
  });

  it('does not self-pair or double-count repeated matching headings', async () => {
    // Two "## Pagination" headings in one doc still yield ONE pair, and an in-area
    // doc is never widened against itself.
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const prd = doc(
      'docs/dupe.md',
      '# Dupe\n\n## Pagination\nCursor paging.\n\n## Pagination\nStill cursor paging.\n',
    );
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('core/pagination', ['docs/pagination.md'])], [note, prd], { runner });
    expect(calls).toBe(1);
    expect(out.get('core/pagination')).toHaveLength(1);
  });

  it('adds nothing when no outside heading matches the area concern', async () => {
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const other = doc('docs/billing.md', '# Billing\n\n## Invoices\nMonthly invoices.\n');
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('core/pagination', ['docs/pagination.md'])], [note, other], { runner });
    expect(calls).toBe(0);
    expect(out.size).toBe(0);
  });

  it('excludes process areas from widening (generic section names are not behavior)', async () => {
    // "## Overview" appears in nearly every doc; a process area must not fan out
    // to every doc that merely has an Overview section.
    const vision = doc('docs/vision.md', '# Vision\n\n## Overview\nThe product vision.\n');
    const prd = doc('docs/prd.md', '# PRD\n\n## Overview\nWhat we build.\n\n## Pagination\nCursor paging.\n');
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('process/overview', ['docs/vision.md'])], [vision, prd], { runner });
    expect(calls).toBe(0);
    expect(out.size).toBe(0);
  });
});

// Windowing: the judge sees each doc's FULL body (no 120-line head slice). Oversized
// docs split into heading-bounded windows and the whole matrix is judged, bounded by
// a per-pair call cap; per-window verdicts aggregate into one.

// A large but realistic API-reference doc, sized to force window splitting. Each
// section is a real heading + a few sentences of prose so cuts land on headings.
function bigMarkdown(title: string, targetChars: number): string {
  let body = `# ${title}\n\nThis document specifies the ${title} HTTP surface.\n\n`;
  let i = 0;
  while (body.length < targetChars) {
    i++;
    body +=
      `## Endpoint ${i}\n\n` +
      `The GET /resource/${i} endpoint returns a paginated list of records. ` +
      `It requires a Bearer token in the Authorization header and responds with 200 on success. ` +
      `The default page size is ${20 + (i % 7)} and callers may raise it to 100. ` +
      `Errors use the standard envelope with a code and message field.\n\n`;
  }
  return body;
}

describe('flagOverlaps — full-body visibility (head-slice regression)', () => {
  // A README whose lint-output example runs long, pushing the "## Rules" section and
  // its "7 rules" claim past line 120 — exactly where the old head slice cut. The
  // other doc states a different count (4), so the conflict lives entirely late.
  const LATE_README = [
    '# sqlfluff',
    '',
    'A dialect-flexible SQL linter and auto-formatter.',
    '',
    '## Example',
    '',
    'Running the linter prints a violation report:',
    '',
    '```',
    ...Array.from({ length: 120 }, (_, i) => `L: ${i + 1} | P: 1 | LT02 | line ${i + 1} is not indented correctly.`),
    '```',
    '',
    '## Rules',
    '',
    'sqlfluff ships with 7 rules enabled by default in the standard profile.',
    '',
  ].join('\n');

  const RULES_DOC = ['# Rule Reference', '', '## Default profile', '', 'The default profile enables 4 rules out of the box.', ''].join('\n');

  it('shows a conflict whose evidence sits PAST line 120 of a doc to the runner', async () => {
    const readme = doc('README.md', LATE_README);
    const rules = doc('docs/RULES.md', RULES_DOC);
    let captured: OverlapRunnerInput | undefined;
    const runner: OverlapRunner = async (i) => {
      captured = i;
      return { overlap: false, note: '' };
    };
    await flagOverlaps(repo, [area('core/rules', ['README.md', 'docs/RULES.md'])], [readme, rules], { runner });
    // The runner receives the FULL body — the late heading + claim are present.
    expect(LATE_README.split('\n').indexOf('## Rules')).toBeGreaterThan(120);
    expect(captured!.a.content).toContain('## Rules');
    expect(captured!.a.content).toContain('7 rules enabled by default');
    // A single window (doc < the char budget) → no part descriptors.
    expect(captured!.aPart).toBeUndefined();
  });

  it('surfaces the late lines and late heading in the real prompt SECTION OPTIONS', () => {
    const readme = doc('README.md', LATE_README);
    const rules = doc('docs/RULES.md', RULES_DOC);
    const prompt = buildOverlapUserPrompt('core/rules', readme, rules);
    expect(prompt).toContain('7 rules enabled by default');
    // The late "## Rules" heading is enumerated as a closed section option.
    expect(prompt).toContain('- Rules');
  });
});

describe('flagOverlaps — window splitting', () => {
  it('splits an oversized doc at heading boundaries into within-budget windows that reassemble to the body', async () => {
    const bigBody = bigMarkdown('Payments API', 55_000);
    const big = doc('docs/payments.md', bigBody);
    const small = doc('docs/note.md', '# Note\n\nA short note about payment defaults.\n');
    const seen: Array<{ index: number; count: number; isFirst: boolean; content: string }> = [];
    const runner: OverlapRunner = async ({ a, aPart }) => {
      seen.push({ index: aPart!.index, count: aPart!.count, isFirst: aPart!.isFirst, content: a.content! });
      return { overlap: false, note: '' };
    };
    await flagOverlaps(repo, [area('core/payments', ['docs/payments.md', 'docs/note.md'])], [big, small], { runner });

    // Side B is a single window, so each A window appears exactly once.
    const count = seen[0].count;
    expect(count).toBeGreaterThan(1);
    expect(seen).toHaveLength(count);
    // Every window respects the char budget.
    for (const w of seen) expect(w.content.length).toBeLessThanOrEqual(OVERLAP_WINDOW_CHARS);
    // Windows reassemble, in index order, to the exact body (the shared chunker
    // packs line-sliced sections, so windows rejoin on the newline it split on).
    const ordered = [...seen].sort((x, y) => x.index - y.index);
    expect(ordered.map((w) => w.content).join('\n')).toBe(bigBody);
    // Only the first window starts the doc; each later one begins at a heading.
    expect(ordered[0].isFirst).toBe(true);
    for (const w of ordered.slice(1)) {
      expect(w.isFirst).toBe(false);
      expect(w.content.startsWith('#')).toBe(true);
    }
  });

  it('a small doc pair is a single window with no part descriptors', async () => {
    const seen: OverlapRunnerInput[] = [];
    const runner: OverlapRunner = async (i) => {
      seen.push(i);
      return { overlap: false, note: '' };
    };
    await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], [doc('a.md'), doc('b.md')], { runner });
    expect(seen).toHaveLength(1);
    expect(seen[0].aPart).toBeUndefined();
    expect(seen[0].bPart).toBeUndefined();
  });
});

describe('buildOverlapUserPrompt — part labels and lead option', () => {
  const a = doc('a.md', '## Auth\ndetails\n\n## Errors\nmore\n');
  const b = doc('b.md', '# B\n\n## Storage\nstuff\n');

  it('labels a windowed side "(part k/n)" and leaves a single-window side unlabeled', () => {
    const prompt = buildOverlapUserPrompt('core/auth', a, b, { index: 2, count: 3, isFirst: false }, undefined);
    expect(prompt).toContain('--- doc A: a.md (part 2/3) ---');
    expect(prompt).toContain('--- doc B: b.md ---');
    expect(prompt).not.toContain('doc B: b.md (part');
  });

  it('offers the lead (heading: null) option ONLY for a window that starts the doc', () => {
    // Doc A is a NON-first window → no lead; doc B is a single window → lead offered.
    const nonFirst = buildOverlapUserPrompt('core/auth', a, b, { index: 2, count: 2, isFirst: false }, undefined);
    expect(nonFirst.match(/use heading: null/g)?.length).toBe(1);
    // The FIRST window of A does offer it, alongside B → two lead options.
    const first = buildOverlapUserPrompt('core/auth', a, b, { index: 1, count: 2, isFirst: true }, undefined);
    expect(first.match(/use heading: null/g)?.length).toBe(2);
  });
});

describe('flagOverlaps — full window matrix', () => {
  it('judges EVERY window pair of two oversized docs — coverage is never truncated', async () => {
    const bodyA = bigMarkdown('Service A', 100_000);
    const bodyB = bigMarkdown('Service B', 100_000);
    const a = doc('docs/a.md', bodyA);
    const b = doc('docs/b.md', bodyB);
    const seen = new Set<string>();
    const runner: OverlapRunner = async ({ aPart, bPart }) => {
      seen.add(`${aPart!.index}-${bPart!.index}`);
      return { overlap: false, note: '' };
    };
    await flagOverlaps(repo, [area('core/svc', ['docs/a.md', 'docs/b.md'])], [a, b], { runner });

    const nA = planDocChunks('docs/a.md', bodyA, OVERLAP_WINDOW_CHARS).length;
    const nB = planDocChunks('docs/b.md', bodyB, OVERLAP_WINDOW_CHARS).length;
    // Both docs split into several windows and every combination was judged once.
    expect(nA).toBeGreaterThan(1);
    expect(nB).toBeGreaterThan(1);
    expect(seen.size).toBe(nA * nB);
  });
});

describe('flagOverlaps — window-verdict aggregation', () => {
  it('merges two windows flagging different disputes into one verdict (notes joined, sections unioned)', async () => {
    const bigBody =
      bigMarkdown('Catalog API', 30_000) +
      '## Rate limits\n\nRate limits apply at 100 requests per minute per token.\n';
    const big = doc('docs/catalog.md', bigBody);
    const small = doc('docs/policy.md', '# Policy\n\nA brief policy note.\n');
    // One verdict per A window: the first flags a page-size dispute, the rest a rate-limit one.
    const runner: OverlapRunner = async ({ aPart }) =>
      aPart!.index === 1
        ? {
            overlap: true,
            note: 'catalog.md and policy.md disagree on default page size',
            sections: [{ doc: 'docs/catalog.md', heading: 'Endpoint 1', quote: 'The default page size is 21' }],
          }
        : {
            overlap: true,
            note: 'catalog.md and policy.md disagree on the rate limit',
            sections: [
              { doc: 'docs/catalog.md', heading: 'Rate limits', quote: 'Rate limits apply at 100 requests per minute per token' },
            ],
          };
    const out = await flagOverlaps(repo, [area('core/catalog', ['docs/catalog.md', 'docs/policy.md'])], [big, small], { runner });
    const overlap = out.get('core/catalog')![0];
    expect(overlap.note).toBe(
      'catalog.md and policy.md disagree on default page size; catalog.md and policy.md disagree on the rate limit',
    );
    expect(overlap.sections.map((s) => s.heading).sort()).toEqual(['Endpoint 1', 'Rate limits']);
  });

  it('flags nothing when every window verdict is false', async () => {
    const big = doc('docs/a.md', bigMarkdown('Svc', 30_000));
    const small = doc('docs/b.md', '# B\n\nA note.\n');
    const runner: OverlapRunner = async () => ({ overlap: false, note: '' });
    const out = await flagOverlaps(repo, [area('core/svc', ['docs/a.md', 'docs/b.md'])], [big, small], { runner });
    expect(out.size).toBe(0);
  });

  it('aggregates the successes on partial failure but does NOT cache (a re-run re-calls the runner)', async () => {
    const big = doc('docs/a.md', bigMarkdown('Svc', 30_000));
    const small = doc('docs/b.md', '# B\n\nA note.\n');
    const areas = [area('core/svc', ['docs/a.md', 'docs/b.md'])];
    let calls = 0;
    // The first window flags; a later window throws → partial coverage.
    const runner: OverlapRunner = async ({ aPart }) => {
      calls++;
      if (aPart!.index === 1) return { overlap: true, note: 'a.md and b.md disagree on defaults', sections: [] };
      throw new Error('window judge failed');
    };
    const first = await flagOverlaps(repo, areas, [big, small], { runner });
    expect(first.get('core/svc')).toHaveLength(1); // the success is aggregated despite the failure
    const callsAfterFirst = calls;
    const second = await flagOverlaps(repo, areas, [big, small], { runner });
    expect(second.get('core/svc')).toHaveLength(1);
    // Nothing was cached (partial coverage) → the second run re-invokes the runner.
    expect(calls).toBe(callsAfterFirst * 2);
  });
});
