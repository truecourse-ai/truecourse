/**
 * `truecourse spec source add|list|refresh|remove` end-to-end against the local
 * fixture docs site — the suite never reaches the real internet.
 *
 * The subject is the command layer: the fetch confirm gate (`-y`, decline,
 * no-TTY), what the typed engine failures print, and the state each command
 * leaves on disk. The fetch/snapshot engine has its own suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Hoisted so the module factory below can reach them (vi.mock is hoisted above
// every other statement in the file).
const { out, answers } = vi.hoisted(() => ({ out: [] as string[], answers: [] as unknown[] }));

// Mocked through the CLI's own copy: pnpm keeps `@clack/prompts` under
// `tools/cli/node_modules`, so the bare specifier does not resolve from this file
// and the mock would silently miss (the real confirm would then block on stdin).
vi.mock('../../tools/cli/node_modules/@clack/prompts', () => {
  const say = (msg?: unknown) => {
    out.push(String(msg ?? ''));
  };
  return {
    intro: say,
    outro: say,
    cancel: say,
    log: { info: say, step: say, message: say, warn: say, error: say, success: say },
    confirm: async (o: { message: string }) => {
      out.push(`confirm: ${o.message}`);
      if (answers.length === 0) throw new Error(`no scripted answer for confirm: ${o.message}`);
      return answers.shift();
    },
    isCancel: (v: unknown) => typeof v === 'symbol',
  };
});

const { runSpecSourceAdd, runSpecSourceList, runSpecSourceRefresh, runSpecSourceRemove } =
  await import('../../tools/cli/src/commands/spec-sources.js');

import {
  readSourcesFile,
  sourceDirPath,
  sourceIdFromUrl,
  sourcesFilePath,
} from '../../packages/spec-consolidator/src/index.js';
import {
  INSTALLATION_MD,
  llmsTxtUrl,
  startDocsSite,
  type FixtureSite,
} from '../spec-consolidator/sources-fixture.js';

let repo: string;
let site: FixtureSite;
let url: string;
let id: string;
let stdinIsTTY: boolean | undefined;
let stderrIsTTY: boolean | undefined;

/**
 * Run a command and collect what it printed. A `process.exit(n)` surfaces as
 * `exit`, so a failure path is asserted on its message AND its code instead of
 * tearing down the worker.
 *
 * `all` is the prompt output PLUS the step renderer's stderr — the two surfaces
 * a user sees at once, which is what "the reason printed exactly once" is about.
 */
async function run(fn: () => Promise<void>): Promise<{ out: string; all: string; exit?: number }> {
  out.length = 0;
  const steps: string[] = [];
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: string | Uint8Array) => {
      steps.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as never);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as never);
  let exit: number | undefined;
  try {
    await fn();
  } catch (err) {
    const match = /^exit:(\d+)$/.exec((err as Error).message);
    if (!match) throw err;
    exit = Number(match[1]);
  } finally {
    stderr.mockRestore();
    exitSpy.mockRestore();
  }
  const printed = out.join('\n');
  return { out: printed, all: `${printed}\n${steps.join('')}`, exit };
}

/** How many times `needle` appears in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Snapshot paths on disk for a source, relative to its dir, forward-slashed. */
function snapshotTree(sourceId: string): string[] {
  const root = sourceDirPath(repo, sourceId);
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return found;
}

beforeEach(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cli-spec-sources-'));
  site = await startDocsSite();
  url = llmsTxtUrl(site);
  id = sourceIdFromUrl(url);
  // The confirm gate branches on the TTY, which the runner may or may not have.
  stdinIsTTY = process.stdin.isTTY;
  (process.stdin as { isTTY?: boolean }).isTTY = false;
  // …and so does the step renderer, which clamps its lines to the terminal width
  // on a TTY. Pin it off so the captured step lines are whole.
  stderrIsTTY = process.stderr.isTTY;
  (process.stderr as { isTTY?: boolean }).isTTY = false;
});

afterEach(async () => {
  (process.stdin as { isTTY?: boolean }).isTTY = stdinIsTTY;
  (process.stderr as { isTTY?: boolean }).isTTY = stderrIsTTY;
  await site.close();
  fs.rmSync(repo, { recursive: true, force: true });
  out.length = 0;
  answers.length = 0;
});

describe('spec source add', () => {
  it('snapshots every markdown page and registers the source', async () => {
    const { out, exit } = await run(() => runSpecSourceAdd(url, { cwd: repo, yes: true }));

    expect(exit).toBeUndefined();
    // 9 links, 7 same-origin; one of those is HTML-only and never converted.
    expect(out).toContain('Found "Strapi Docs" — 9 pages (7 fetchable, 2 skipped)');
    expect(out).toContain('6 written · 3 skipped');
    expect(out).toContain('external-origin');
    expect(out).toContain('not-markdown');
    expect(out).toContain('Run `truecourse spec scan` to fold the new docs into the corpus.');

    expect(snapshotTree(id)).toEqual([
      'cms/api/rest.md',
      'cms/content-type-builder.md',
      'cms/draft-and-publish.md',
      'cms/installation.md',
      'cms/quick-start.md',
      'design-system.md',
    ]);
    const registry = readSourcesFile(repo);
    expect(registry.sources).toHaveLength(1);
    expect(registry.sources[0].id).toBe(id);
    expect(registry.sources[0].title).toBe('Strapi Docs');
    expect(registry.sources[0].llmsTxtUrl).toBe(url);
    expect(registry.sources[0].docs).toHaveLength(6);
  });

  it('honors --id for the registry entry and the snapshot directory', async () => {
    await run(() => runSpecSourceAdd(url, { cwd: repo, yes: true, id: 'Strapi Docs' }));

    expect(readSourcesFile(repo).sources[0].id).toBe('strapi-docs');
    expect(fs.existsSync(sourceDirPath(repo, 'strapi-docs'))).toBe(true);
    expect(fs.existsSync(sourceDirPath(repo, id))).toBe(false);
  });

  it('declining the confirm writes nothing and exits clean', async () => {
    (process.stdin as { isTTY?: boolean }).isTTY = true;
    answers.push(false);

    const { out, exit } = await run(() => runSpecSourceAdd(url, { cwd: repo }));

    expect(exit).toBe(0);
    expect(out).toContain('confirm: Fetch now?');
    expect(out).toContain('Cancelled — nothing fetched.');
    expect(fs.existsSync(sourcesFilePath(repo))).toBe(false);
    expect(fs.existsSync(sourceDirPath(repo, id))).toBe(false);
    // Only the llms.txt was read — no page was fetched.
    expect(site.hitsFor('/cms/quick-start.md')).toBe(0);
  });

  it('refuses to fetch non-interactively without --yes', async () => {
    const { out, exit } = await run(() => runSpecSourceAdd(url, { cwd: repo }));

    expect(exit).toBe(1);
    expect(out).toContain('Cannot prompt for confirmation non-interactively. Pass --yes');
    expect(out).not.toContain('confirm:');
    expect(fs.existsSync(sourcesFilePath(repo))).toBe(false);
  });

  it('rejects a URL that is not an llms.txt, showing one', async () => {
    const { out, exit } = await run(() =>
      runSpecSourceAdd(`${site.origin}/docs`, { cwd: repo, yes: true }),
    );

    expect(exit).toBe(1);
    expect(out).toContain('not an llms.txt URL');
    expect(out).toContain('https://docs.strapi.io/llms.txt');
    expect(site.hits).toHaveLength(0);
  });

  it('refuses a second add of the same URL and points at refresh', async () => {
    await run(() => runSpecSourceAdd(url, { cwd: repo, yes: true }));
    site.hits.length = 0;
    const { out, all, exit } = await run(() => runSpecSourceAdd(url, { cwd: repo, yes: true }));

    expect(exit).toBe(1);
    expect(out).toContain('is already registered');
    expect(out).toContain(`truecourse spec source refresh ${id}`);
    expect(readSourcesFile(repo).sources).toHaveLength(1);
    // Decided from the local registry: nothing was requested, nothing previewed,
    // and no confirm was offered for a fetch that could never land.
    expect(site.hits).toEqual([]);
    expect(out).not.toContain('Found "Strapi Docs"');
    expect(out).not.toContain('confirm:');
    // The reason belongs to the closing line — the failed step must not repeat it.
    expect(occurrences(all, 'is already registered')).toBe(1);
  });

  it('prompts for the confirm before a first add, and only then fetches', async () => {
    (process.stdin as { isTTY?: boolean }).isTTY = true;
    answers.push(true);

    const { out, exit } = await run(() => runSpecSourceAdd(url, { cwd: repo }));

    expect(exit).toBeUndefined();
    expect(out).toContain('confirm: Fetch now?');
    expect(readSourcesFile(repo).sources).toHaveLength(1);
  });
});

describe('spec source list', () => {
  it('lists id, title, page count, last fetch, and the llms.txt URL', async () => {
    await run(() => runSpecSourceAdd(url, { cwd: repo, yes: true }));
    const { out, exit } = await run(() => runSpecSourceList({ cwd: repo }));

    expect(exit).toBeUndefined();
    expect(out).toContain(`${id}  —  Strapi Docs`);
    expect(out).toContain('6 pages · fetched ');
    expect(out).toContain(url);
  });

  it('says so when nothing is registered, and shows how to add one', async () => {
    const { out, exit } = await run(() => runSpecSourceList({ cwd: repo }));

    expect(exit).toBeUndefined();
    expect(out).toContain('No sources registered.');
    expect(out).toContain('truecourse spec source add <llms-txt-url>');
  });
});

describe('spec source refresh', () => {
  /** The site publishes a page, edits another, and unlists a third. */
  function mutateSite(): void {
    site.routes['/cms/relations.md'] = {
      body: '# Relations\n\nRelations connect entries of two content-types.\n',
    };
    site.routes['/cms/installation.md'] = {
      body: `${INSTALLATION_MD}\n## Upgrading\n\nRun the upgrade tool.\n`,
    };
    site.routes['/llms.txt'] = {
      body: (origin) => `# Strapi Docs

## CMS

- [Quick Start Guide](/cms/quick-start.md): Create a project and query it in ten minutes.
- [Installation](${origin}/cms/installation.md): Install with the CLI, a template, or Docker.
- [Relations](${origin}/cms/relations.md): Connect entries across content-types.
- [Content-Type Builder](${origin}/cms/content-type-builder): Model collection and single types.
- [REST API](${origin}/cms/api/rest#filters): Filters, sort, pagination, populate.

## Optional

- [Design System](${origin}/design-system.md): The admin panel component library.
`,
      contentType: 'text/plain; charset=utf-8',
    };
  }

  it('reports the diff and reconciles the snapshot with the site', async () => {
    await run(() => runSpecSourceAdd(url, { cwd: repo, yes: true }));
    mutateSite();

    const { out, exit } = await run(() => runSpecSourceRefresh(undefined, { cwd: repo }));

    expect(exit).toBeUndefined();
    expect(out).toContain('1 added · 1 changed · 1 removed · 4 unchanged');
    expect(out).toContain('+ cms/relations.md');
    expect(out).toContain('~ cms/installation.md');
    expect(out).toContain('- cms/draft-and-publish.md');
    expect(out).toContain('Run `truecourse spec scan` to fold the new docs into the corpus.');

    expect(snapshotTree(id)).toEqual([
      'cms/api/rest.md',
      'cms/content-type-builder.md',
      'cms/installation.md',
      'cms/quick-start.md',
      'cms/relations.md',
      'design-system.md',
    ]);
    expect(readSourcesFile(repo).sources[0].docs.map((doc) => doc.path)).not.toContain(
      'cms/draft-and-publish.md',
    );
  });

  it('says nothing changed when the site is unchanged', async () => {
    await run(() => runSpecSourceAdd(url, { cwd: repo, yes: true }));

    const { out, exit } = await run(() => runSpecSourceRefresh(id, { cwd: repo }));

    expect(exit).toBeUndefined();
    expect(out).toContain('0 added · 0 changed · 0 removed · 6 unchanged');
    expect(out).toContain('Everything is up to date — no page changed.');
  });

  it('rejects an unknown id and lists the registered ones', async () => {
    await run(() => runSpecSourceAdd(url, { cwd: repo, yes: true }));

    const { out, exit } = await run(() => runSpecSourceRefresh('docs.nope.io', { cwd: repo }));

    expect(exit).toBe(1);
    expect(out).toContain('no registered spec source "docs.nope.io"');
    expect(out).toContain(`Registered: ${id}`);
  });

  it('prints a mid-run fetch failure exactly once', async () => {
    await run(() => runSpecSourceAdd(url, { cwd: repo, yes: true }));
    // The site 500s past every retry (`retry-after: 0` keeps the backoff instant).
    site.routes['/llms.txt'] = {
      ...site.routes['/llms.txt'],
      failFirst: { times: 99, status: 500, retryAfter: '0' },
    };

    const { out, all, exit } = await run(() => runSpecSourceRefresh(id, { cwd: repo }));

    expect(exit).toBe(1);
    expect(out).toContain('HTTP 500');
    // The step shows ✕ with no reason; the cancel line owns the sentence.
    expect(occurrences(all, 'HTTP 500')).toBe(1);
    // A failed refresh keeps the last good snapshot.
    expect(readSourcesFile(repo).sources[0].docs).toHaveLength(6);
  });

  it('says so when nothing is registered', async () => {
    const { out, exit } = await run(() => runSpecSourceRefresh(undefined, { cwd: repo }));

    expect(exit).toBeUndefined();
    expect(out).toContain('No sources registered.');
  });
});

describe('spec source remove', () => {
  it('deletes the snapshot and the registry entry', async () => {
    await run(() => runSpecSourceAdd(url, { cwd: repo, yes: true }));

    const { out, exit } = await run(() => runSpecSourceRemove(id, { cwd: repo }));

    expect(exit).toBeUndefined();
    expect(out).toContain(`Removed ${id}  —  Strapi Docs (6 pages)`);
    expect(fs.existsSync(sourceDirPath(repo, id))).toBe(false);
    expect(readSourcesFile(repo).sources).toEqual([]);
  });

  it('rejects an unknown id and lists the registered ones', async () => {
    await run(() => runSpecSourceAdd(url, { cwd: repo, yes: true }));

    const { out, exit } = await run(() => runSpecSourceRemove('docs.nope.io', { cwd: repo }));

    expect(exit).toBe(1);
    expect(out).toContain(`Registered: ${id}`);
    expect(readSourcesFile(repo).sources).toHaveLength(1);
  });

  it('points at add when nothing is registered at all', async () => {
    const { out, exit } = await run(() => runSpecSourceRemove('docs.nope.io', { cwd: repo }));

    expect(exit).toBe(1);
    expect(out).toContain('nothing is registered yet');
    expect(out).toContain('truecourse spec source add <llms-txt-url>');
  });
});
