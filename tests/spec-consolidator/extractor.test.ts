import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractClaims,
  summarizeExtractionFailures,
  type BlockRunner,
  type LlmExtraction,
  type LlmClaim,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * Extractor tests use a stubbed runner — no real LLM subprocess.
 * The stub takes a function that maps each block to a canned
 * LlmExtraction, so tests pin assembly behavior precisely:
 *
 *   - id stability across runs
 *   - provenance attachment (file, line, quoted snippet)
 *   - metadata attachment (docKind, lastTouched, status)
 *   - failure-passthrough (block runs that errored don't drop the batch)
 *   - line override (LLM may pin a claim to a finer line within its block)
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-extr-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function place(rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function stubRunner(
  reply: (block: import('../../packages/spec-consolidator/src/index.js').Block) => LlmExtraction | Error,
): BlockRunner {
  return async (blocks) =>
    blocks.map((block) => {
      const r = reply(block);
      if (r instanceof Error) {
        return { block, error: r.message, durationMs: 1 };
      }
      return { block, extraction: r, durationMs: 1 };
    });
}

describe('extractClaims — assembly', () => {
  it('wraps each LLM claim with id + provenance + metadata', async () => {
    place(
      'docs/PRDs/feature.md',
      [
        '# Feature',
        '## Endpoints',
        '',
        '### POST /orders',
        'create body',
        '',
        '### GET /orders',
        'list body',
      ].join('\n'),
    );

    const runner = stubRunner((block) => {
      if (block.headingPath.at(-1) === 'POST /orders') {
        const claim: LlmClaim = {
          topic: 'endpoints',
          subject: 'POST /orders',
          content: { method: 'POST', path: '/orders' },
          status: 'shipped',
        };
        return { topics: ['endpoints'], claims: [claim] };
      }
      return { topics: [], claims: [] };
    });

    const result = await extractClaims(root, { runner, skipGit: true });
    expect(result.claims).toHaveLength(1);
    const claim = result.claims[0];
    expect(claim.subject).toBe('POST /orders');
    expect(claim.topic).toBe('endpoints');
    expect(claim.id).toMatch(/^[a-f0-9]{64}$/);
    expect(claim.provenance.file).toBe('docs/PRDs/feature.md');
    expect(claim.provenance.line).toBeGreaterThan(0);
    expect(claim.provenance.quote).toContain('### POST /orders');
    expect(claim.metadata.docKind).toBe('prd');
    expect(claim.metadata.status).toBe('shipped');
  });

  it('produces stable claim ids across runs (cache safety)', async () => {
    place('docs/x.md', '## A\nbody\n');
    const runner = stubRunner(() => ({
      topics: ['overview'],
      claims: [{ topic: 'overview', subject: 'something', content: {} }],
    }));
    const a = await extractClaims(root, { runner, skipGit: true });
    const b = await extractClaims(root, { runner, skipGit: true });
    expect(a.claims[0].id).toBe(b.claims[0].id);
  });

  it('honors LLM-supplied line override for finer provenance', async () => {
    place(
      'docs/x.md',
      [
        '## A',          // line 1
        'lead-in',       // 2
        '',              // 3
        'POST /orders.', // 4 — claim grounded here
        '',
        '## B',
        'b body',
      ].join('\n'),
    );
    const runner = stubRunner((block) => {
      if (block.headingPath.at(-1) === 'A') {
        return {
          topics: ['endpoints'],
          claims: [{ topic: 'endpoints', subject: 'POST /orders', content: {}, line: 4 }],
        };
      }
      return { topics: [], claims: [] };
    });
    const result = await extractClaims(root, { runner, skipGit: true });
    const a = result.claims.find((c) => c.subject === 'POST /orders')!;
    expect(a.provenance.line).toBe(4);
  });

  it('returns empty claims for blocks with no extractable content', async () => {
    place('docs/prose.md', '# Pure prose\nno claims here, just narrative.\n');
    const runner = stubRunner(() => ({ topics: [], claims: [] }));
    const result = await extractClaims(root, { runner, skipGit: true });
    expect(result.claims).toEqual([]);
    expect(result.blocksAttempted).toBe(1);
  });

  it('preserves block runs that errored — partial success is allowed', async () => {
    place(
      'docs/x.md',
      ['## Good', 'good body', '', '## Bad', 'bad body'].join('\n'),
    );
    const runner = stubRunner((block) => {
      if (block.headingPath.at(-1) === 'Bad') {
        return new Error('subprocess timeout');
      }
      return {
        topics: ['overview'],
        claims: [{ topic: 'overview', subject: block.headingPath.at(-1)!, content: {} }],
      };
    });
    const result = await extractClaims(root, { runner, skipGit: true });
    expect(result.claims.map((c) => c.subject)).toEqual(['Good']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].error).toContain('timeout');
  });

  it('skips fully when no docs are found', async () => {
    place('not-markdown.txt', 'plain');
    const runner = stubRunner(() => ({ topics: [], claims: [] }));
    const result = await extractClaims(root, { runner, skipGit: true });
    expect(result).toEqual({
      claims: [],
      failures: [],
      blocksAttempted: 0,
      docsScanned: 0,
    });
  });

  it('walks multiple docs and attributes claims to the right one', async () => {
    place('docs/PRDs/a.md', '## A\n');
    place('docs/PRDs/b.md', '## B\n');
    const runner = stubRunner((block) => ({
      topics: ['overview'],
      claims: [
        {
          topic: 'overview',
          subject: `${block.filePath}:${block.headingPath.at(-1)}`,
          content: {},
        },
      ],
    }));
    const result = await extractClaims(root, { runner, skipGit: true });
    const subjects = result.claims.map((c) => c.subject).sort();
    expect(subjects).toEqual([
      'docs/PRDs/a.md:A',
      'docs/PRDs/b.md:B',
    ]);
  });

  it('gives different ids to claims of the same subject in different files', async () => {
    place('docs/a.md', '## X\n');
    place('docs/b.md', '## X\n');
    const runner = stubRunner(() => ({
      topics: ['overview'],
      claims: [{ topic: 'overview', subject: 'global error envelope', content: {} }],
    }));
    const result = await extractClaims(root, { runner, skipGit: true });
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0].id).not.toBe(result.claims[1].id);
  });
});

describe('extractClaims — progress hooks', () => {
  it('fires onDocStart and onDocDone with accurate counts', async () => {
    place('docs/PRDs/a.md', '## A\n## B\n');
    const runner = stubRunner((block) => ({
      topics: ['overview'],
      claims: [{ topic: 'overview', subject: block.headingPath.at(-1)!, content: {} }],
    }));
    const events: string[] = [];
    await extractClaims(root, {
      runner,
      skipGit: true,
      onDocStart: (doc) => events.push(`start ${doc.path}`),
      onDocDone: (doc, blocks, claims) => events.push(`done ${doc.path} blocks=${blocks} claims=${claims}`),
    });
    expect(events).toContain('start docs/PRDs/a.md');
    expect(events).toContain('done docs/PRDs/a.md blocks=2 claims=2');
  });

  it('fires onBlockFailure for runner errors', async () => {
    place('docs/x.md', '## A\n');
    const runner = stubRunner(() => new Error('boom'));
    const failures: string[] = [];
    await extractClaims(root, {
      runner,
      skipGit: true,
      onBlockFailure: (block, error) => failures.push(`${block.headingPath.at(-1)}: ${error}`),
    });
    expect(failures).toEqual(['A: boom']);
  });
});

describe('summarizeExtractionFailures', () => {
  const fail = (error: string, n = 1) => Array.from({ length: n }, () => ({ error }));

  it('reports nothing when there are no failures', () => {
    const r = summarizeExtractionFailures({ failures: [], blocksAttempted: 10 });
    expect(r).toEqual({ total: 0, allFailed: false, samples: [] });
  });

  it('flags allFailed only when every attempted block failed', () => {
    expect(
      summarizeExtractionFailures({ failures: fail('boom', 10), blocksAttempted: 10 }).allFailed,
    ).toBe(true);
    expect(
      summarizeExtractionFailures({ failures: fail('boom', 4), blocksAttempted: 10 }).allFailed,
    ).toBe(false);
  });

  it('never flags allFailed when no blocks were attempted', () => {
    const r = summarizeExtractionFailures({ failures: [], blocksAttempted: 0 });
    expect(r.allFailed).toBe(false);
  });

  it('collapses duplicate messages into samples with counts, most frequent first', () => {
    const r = summarizeExtractionFailures({
      failures: [...fail('A', 5), ...fail('B', 2), ...fail('C', 1)],
      blocksAttempted: 8,
    });
    expect(r.total).toBe(8);
    expect(r.samples).toEqual([
      { message: 'A', count: 5 },
      { message: 'B', count: 2 },
      { message: 'C', count: 1 },
    ]);
  });

  it('caps samples at the limit (default 3, overridable)', () => {
    const failures = [
      ...fail('A', 4),
      ...fail('B', 3),
      ...fail('C', 2),
      ...fail('D', 1),
    ];
    expect(summarizeExtractionFailures({ failures, blocksAttempted: 10 }).samples).toHaveLength(3);
    expect(
      summarizeExtractionFailures({ failures, blocksAttempted: 10 }, { sampleLimit: 2 }).samples,
    ).toHaveLength(2);
  });
});

describe('extractClaims — claim shape pins', () => {
  it('claim id is sha256(file + line + topic + subject) — deterministic across processes', async () => {
    place('docs/x.md', '## A\nbody\n');
    const runner = stubRunner(() => ({
      topics: ['endpoints'],
      claims: [{ topic: 'endpoints', subject: 'POST /a', content: {}, line: 2 }],
    }));
    const result = await extractClaims(root, { runner, skipGit: true });
    // Recompute the id outside the extractor and assert match.
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256')
      .update('docs/x.md:2:endpoints:POST /a')
      .digest('hex');
    expect(result.claims[0].id).toBe(expected);
  });

  it('truncates long quotes in provenance to keep the dashboard view tight', async () => {
    const lines = ['## A', ...Array.from({ length: 60 }, (_, i) => `line ${i}`)];
    place('docs/long.md', lines.join('\n'));
    const runner = stubRunner(() => ({
      topics: ['overview'],
      claims: [{ topic: 'overview', subject: 'A', content: {} }],
    }));
    const result = await extractClaims(root, { runner, skipGit: true });
    const quote = result.claims[0].provenance.quote;
    const quoteLines = quote.split('\n');
    expect(quoteLines.length).toBeLessThanOrEqual(41); // 40 + ellipsis line
    expect(quote).toMatch(/\(\+\d+ more lines\)/);
  });
});
