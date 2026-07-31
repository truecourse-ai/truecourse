/**
 * The `spec source` command layer: the confirm gate that stands between a user
 * and a whole documentation site, and the progress steps both the CLI checklist
 * and the dashboard popup render from.
 *
 * Runs against the local fixture site — the counters asserted here are the ones
 * a user actually watches move.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addSpecSourceInProcess,
  refreshSpecSourcesInProcess,
  refreshStepKey,
  removeSpecSourceInProcess,
  resolveSpecSources,
  sourceRefreshSteps,
  SourceFetchDeclined,
  SOURCE_ADD_STEPS,
} from '../../packages/core/src/commands/spec-sources.js';
import { StepTracker, type AnalysisStep } from '../../packages/core/src/progress.js';
import {
  readSourcesFile,
  sourceDirPath,
  sourceIdFromUrl,
  sourcesFilePath,
} from '../../packages/spec-consolidator/src/index.js';
import { llmsTxtUrl, startDocsSite, type FixtureSite } from '../spec-consolidator/sources-fixture.js';

let repo: string;
let site: FixtureSite;
let url: string;
let id: string;
const extraSites: FixtureSite[] = [];

interface Recorder {
  tracker: StepTracker;
  /** Every emitted checklist, in order. */
  frames: AnalysisStep[][];
  /** `<status> <detail>` for one step, deduped consecutively. */
  timeline(key: string): string[];
}

function recorder(stepDefs: readonly { key: string; label: string }[]): Recorder {
  const frames: AnalysisStep[][] = [];
  const tracker = new StepTracker(
    // The tracker emits its live step objects — copy each frame or every one of
    // them reads back as the final state.
    (payload) => frames.push((payload.steps ?? []).map((step) => ({ ...step }))),
    stepDefs.map((step) => ({ ...step })),
  );
  return {
    tracker,
    frames,
    timeline(key) {
      const out: string[] = [];
      for (const frame of frames) {
        const step = frame.find((entry) => entry.key === key);
        if (!step) continue;
        const line = `${step.status}${step.detail ? ` ${step.detail}` : ''}`;
        if (out[out.length - 1] !== line) out.push(line);
      }
      return out;
    },
  };
}

beforeEach(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-sources-inproc-'));
  site = await startDocsSite();
  url = llmsTxtUrl(site);
  id = sourceIdFromUrl(url);
});

afterEach(async () => {
  while (extraSites.length) await extraSites.pop()!.close();
  await site.close();
  fs.rmSync(repo, { recursive: true, force: true });
});

/** A second docs site — a source is keyed by its llms.txt URL, so it needs one. */
async function anotherSite(): Promise<FixtureSite> {
  const other = await startDocsSite();
  extraSites.push(other);
  return other;
}

describe('addSpecSourceInProcess', () => {
  it('shows the page counts before fetching and aborts when they are refused', async () => {
    const seen: string[] = [];
    await expect(
      addSpecSourceInProcess(repo, url, {
        onConfirm: (preview) => {
          seen.push(`${preview.title} ${preview.totalLinks}/${preview.fetchableLinks}`);
          return false;
        },
      }),
    ).rejects.toBeInstanceOf(SourceFetchDeclined);

    expect(seen).toEqual(['Strapi Docs 9/7']);
    expect(fs.existsSync(sourcesFilePath(repo))).toBe(false);
    expect(fs.existsSync(sourceDirPath(repo, id))).toBe(false);
    // The preview costs exactly one request; nothing else was touched.
    expect(site.hits.map((hit) => hit.path)).toEqual(['/llms.txt']);
  });

  it('creates .truecourse/ on the first add', async () => {
    await addSpecSourceInProcess(repo, url, {});
    expect(fs.existsSync(path.join(repo, '.truecourse', '.gitignore'))).toBe(true);
    expect(readSourcesFile(repo).sources).toHaveLength(1);
  });

  it('drives the llms.txt step, then a moving page counter', async () => {
    const rec = recorder(SOURCE_ADD_STEPS);
    await addSpecSourceInProcess(repo, url, { tracker: rec.tracker });

    expect(rec.timeline('fetch')).toEqual(['active', 'done 7 pages']);
    const pages = rec.timeline('pages');
    expect(pages).toContain('active fetched 0/7');
    expect(pages).toContain('active fetched 7/7');
    expect(pages[pages.length - 1]).toBe('done 6 written · 3 skipped');
  });

  it('marks the llms.txt step failed when the site has no llms.txt', async () => {
    delete site.routes['/llms.txt'];
    const rec = recorder(SOURCE_ADD_STEPS);

    await expect(
      addSpecSourceInProcess(repo, url, { tracker: rec.tracker, retries: 0 }),
    ).rejects.toThrow(/could not read/);

    const fetchStep = rec.timeline('fetch');
    expect(fetchStep[0]).toBe('active');
    expect(fetchStep[1]).toMatch(/^error could not read .* HTTP 404/);
    expect(rec.timeline('pages')).toEqual(['pending']);
  });
});

describe('refreshSpecSourcesInProcess', () => {
  it('gives every targeted source its own step and diff summary', async () => {
    await addSpecSourceInProcess(repo, url, {});
    site.routes['/cms/quick-start.md'] = { body: '# Quick Start Guide\n\nRewritten.\n' };

    const targets = resolveSpecSources(repo);
    expect(sourceRefreshSteps(targets)).toEqual([
      { key: refreshStepKey(id), label: 'Refreshing Strapi Docs' },
    ]);

    const rec = recorder(sourceRefreshSteps(targets));
    const [result] = await refreshSpecSourcesInProcess(repo, { tracker: rec.tracker });

    expect(result.changed).toEqual(['cms/quick-start.md']);
    const timeline = rec.timeline(refreshStepKey(id));
    expect(timeline[0]).toBe('active');
    expect(timeline).toContain('active fetched 7/7');
    expect(timeline[timeline.length - 1]).toBe(
      'done 0 added · 1 changed · 0 removed · 5 unchanged · 3 skipped',
    );
  });

  it('refreshes only the named source', async () => {
    const other = await anotherSite();
    await addSpecSourceInProcess(repo, url, {});
    await addSpecSourceInProcess(repo, llmsTxtUrl(other), { id: 'second' });
    site.hits.length = 0;
    other.hits.length = 0;

    const results = await refreshSpecSourcesInProcess(repo, { sourceId: 'second' });

    expect(results.map((result) => result.source.id)).toEqual(['second']);
    expect(site.hits).toEqual([]);
    expect(other.hitsFor('/llms.txt')).toBe(1);
  });
});

describe('resolveSpecSources', () => {
  it('returns every source, or the one named', async () => {
    expect(resolveSpecSources(repo)).toEqual([]);
    await addSpecSourceInProcess(repo, url, {});
    expect(resolveSpecSources(repo).map((source) => source.id)).toEqual([id]);
    expect(resolveSpecSources(repo, id).map((source) => source.id)).toEqual([id]);
  });

  it('throws SourceNotFoundError for an id nobody registered', async () => {
    expect(() => resolveSpecSources(repo, 'docs.nope.io')).toThrow(
      'no registered spec source "docs.nope.io"',
    );
  });
});

describe('removeSpecSourceInProcess', () => {
  it('takes the snapshot and the registry entry away', async () => {
    await addSpecSourceInProcess(repo, url, {});
    const removed = removeSpecSourceInProcess(repo, id);
    expect(removed.docs).toHaveLength(6);
    expect(fs.existsSync(sourceDirPath(repo, id))).toBe(false);
    expect(readSourcesFile(repo).sources).toEqual([]);
  });
});
