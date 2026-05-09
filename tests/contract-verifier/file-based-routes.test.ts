import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initParsers } from '../../packages/analyzer/src/index.js';
import { extractFileBasedRoutesFromDir } from '../../packages/contract-verifier/src/extractor/file-based-routes.js';

/**
 * Layer-2 tests for the file-based route extractor. Each test sets up
 * a tmp directory mimicking a real framework's layout, runs the
 * extractor, and asserts the URLs + methods land where expected.
 */

let root: string;

beforeAll(async () => {
  await initParsers();
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fbr-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function place(rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

// ---------------------------------------------------------------------------
// Next.js App Router
// ---------------------------------------------------------------------------

describe('Next.js App Router (app/api/**/route.ts)', () => {
  it('extracts a basic GET route from app/api/users/route.ts', async () => {
    place(
      'app/api/users/route.ts',
      `
        export async function GET(request: Request) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
      `,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /api/users');
  });

  it('handles a dynamic [id] segment as {id}', async () => {
    place(
      'app/api/users/[id]/route.ts',
      `export async function GET() {}`,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /api/users/{id}');
  });

  it('emits one Operation per HTTP-method export in the same file', async () => {
    place(
      'app/api/widgets/route.ts',
      `
        export async function GET() {}
        export async function POST() {}
        export async function DELETE() {}
      `,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    const ids = ops.map((o) => o.identity).sort();
    expect(ids).toContain('GET /api/widgets');
    expect(ids).toContain('POST /api/widgets');
    expect(ids).toContain('DELETE /api/widgets');
  });

  it('skips files in app/api that are not named route.ts', async () => {
    place('app/api/users/helpers.ts', `export const x = 1;`);
    const ops = await extractFileBasedRoutesFromDir(root);
    expect(ops).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Next.js Pages Router
// ---------------------------------------------------------------------------

describe('Next.js Pages Router (pages/api/**)', () => {
  it('extracts named-export methods from pages/api/foo.ts', async () => {
    place(
      'pages/api/foo.ts',
      `export async function POST() {}`,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('POST /api/foo');
  });

  it('treats /pages/api/users/index.ts as /api/users (not /api/users/index)', async () => {
    place(
      'pages/api/users/index.ts',
      `export async function GET() {}`,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /api/users');
  });

  it('also scans src/pages/api/ for projects with a src/ root', async () => {
    place(
      'src/pages/api/orders/[id].ts',
      `export async function GET() {}`,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /api/orders/{id}');
  });
});

// ---------------------------------------------------------------------------
// Astro
// ---------------------------------------------------------------------------

describe('Astro (src/pages/**)', () => {
  it('extracts a lowercase `get` export — the older Astro convention', async () => {
    // Real-world example: this is what mevboost.org's stats endpoint
    // looks like. The extractor must handle the lowercase form.
    place(
      'src/pages/stats.ts',
      `
        import Redis from 'ioredis';
        const redis = new Redis();
        export async function get() {
          const stats = JSON.parse(await redis.get('stats') ?? '{}');
          return new Response(JSON.stringify(stats));
        }
      `,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /stats');
  });

  it('uses /<segment> for top-level Astro pages — no /api prefix', async () => {
    // Astro's pages-as-endpoints convention: the URL is the file path
    // under src/pages, with no implicit /api prefix.
    place(
      'src/pages/articles/[slug].ts',
      `export async function GET() {}`,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /articles/{slug}');
  });
});

// ---------------------------------------------------------------------------
// SvelteKit
// ---------------------------------------------------------------------------

describe('SvelteKit (src/routes/**/+server.ts)', () => {
  it('extracts the URL from the parent directory chain (+server.ts marker)', async () => {
    place(
      'src/routes/api/articles/+server.ts',
      `
        export async function GET() {}
        export async function POST() {}
      `,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    const ids = ops.map((o) => o.identity).sort();
    expect(ids).toContain('GET /api/articles');
    expect(ids).toContain('POST /api/articles');
  });

  it('skips non-+server files in src/routes/', async () => {
    place('src/routes/api/articles/+page.ts', `export const load = () => ({});`);
    const ops = await extractFileBasedRoutesFromDir(root);
    expect(ops).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

describe('cross-cutting', () => {
  it('returns no operations when no route directories exist', async () => {
    place('src/lib/helpers.ts', `export const x = 1;`);
    const ops = await extractFileBasedRoutesFromDir(root);
    expect(ops).toEqual([]);
  });

  it('handles arrow-function exports as well as function declarations', async () => {
    // export const GET = async () => { … }  is increasingly common
    // (matches Astro 4+ examples).
    place(
      'src/pages/articles.ts',
      `export const GET = async () => new Response('[]');`,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /articles');
  });

  it('finds route roots nested under monorepo subdirectories', async () => {
    // Real-world layout: mevboost.org has its Astro pages at
    // `frontend/src/pages/stats.ts`, not at `<repo>/src/pages/stats.ts`.
    // The extractor must walk into subdirectories looking for the
    // wanted layout, not just check the immediate root.
    place(
      'frontend/src/pages/stats.ts',
      `export async function get() {}`,
    );
    place(
      'apps/api/app/api/users/route.ts',
      `export async function GET() {}`,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    const ids = ops.map((o) => o.identity).sort();
    expect(ids).toContain('GET /stats');
    expect(ids).toContain('GET /api/users');
  });

  it('skips node_modules and other build dirs when scanning', async () => {
    // We must not descend into node_modules — third-party packages can
    // contain their own pages/api or app/api directories that aren't
    // the user's routes.
    place(
      'node_modules/some-pkg/pages/api/leaked.ts',
      `export async function GET() {}`,
    );
    place(
      'pages/api/real.ts',
      `export async function GET() {}`,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    const ids = ops.map((o) => o.identity);
    expect(ids).toContain('GET /api/real');
    expect(ids).not.toContain('GET /api/leaked');
  });

  it('attributes the response status from the handler body to the operation', async () => {
    // The file-based extractor reuses the same response walker the
    // Express extractor uses — implicit-200 on bare sends, explicit
    // status from `Response.status` is not yet handled (different
    // shape from `res.status(N)`), but `res.json(...)` style still
    // works if the file uses Express response object.
    place(
      'pages/api/users.ts',
      `
        import type { NextApiRequest, NextApiResponse } from 'next';
        export async function GET(req: NextApiRequest, res: NextApiResponse) {
          res.status(201).json({ ok: true });
        }
      `,
    );
    const ops = await extractFileBasedRoutesFromDir(root);
    const op = ops.find((o) => o.identity === 'GET /api/users')!;
    expect(op.contract.responses.map((r) => r.status)).toContain('201');
  });
});
