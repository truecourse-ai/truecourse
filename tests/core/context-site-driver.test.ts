/**
 * The `site` driver — an llms.txt documentation site as a WORKSPACE source.
 *
 * Every fetch goes to a local fixture site, never the real internet. What is
 * asserted is the driver's contract: a check reads the index and stores
 * nothing, a sync hands back every page with its body and a diff against the
 * ledger, snapshot paths stay put when a neighbour moves, and nothing is
 * written to any tree — a workspace source has no `sources.json` and no
 * `.truecourse/specs/sources/` directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSiteDriver } from '@truecourse/core/services/context';
import type { ContextLedgerEntry } from '@truecourse/core/services/context';
import { hashContent } from '../../packages/spec-consolidator/src/index.js';
import {
  INSTALLATION_MD,
  docsSiteRoutes,
  llmsTxtUrl,
  startSite,
  type FixtureSite,
} from '../spec-consolidator/sources-fixture.js';

let site: FixtureSite;
let scratch: string;

beforeEach(async () => {
  site = await startSite(docsSiteRoutes());
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-context-site-'));
});

afterEach(async () => {
  await site.close();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const driver = () => createSiteDriver({ now: () => new Date('2026-09-10T10:00:00.000Z') });

const config = () => ({ llmsTxtUrl: llmsTxtUrl(site) });

describe('site driver — check', () => {
  it('reports what an add would yield, and the first titles', async () => {
    const check = await driver().check(config());
    expect(check.title).toBe('Strapi Docs');
    expect(check.count).toBeGreaterThan(0);
    expect(check.titles.length).toBeGreaterThan(0);
    expect(check.titles).toContain('Installation');
  });

  it('costs exactly one request and writes nothing', async () => {
    await driver().check(config());
    expect(site.hits.map((hit) => hit.path)).toEqual(['/llms.txt']);
    expect(fs.readdirSync(scratch)).toEqual([]);
  });

  it('reports the off-origin links it would never fetch', async () => {
    const check = await driver().check(config());
    expect(check.skipped.some((skip) => skip.reason === 'external-origin')).toBe(true);
  });

  it('refuses a URL that is not an llms.txt', async () => {
    await expect(driver().check({ llmsTxtUrl: `${site.origin}/docs` })).rejects.toThrow();
  });
});

describe('site driver — sync', () => {
  it('hands back every fetched page with its body, path and hash', async () => {
    const result = await driver().sync(config(), []);
    const install = result.documents.find((doc) => doc.docId.endsWith('/cms/installation.md'));
    expect(install).toBeDefined();
    expect(install!.body).toBe(INSTALLATION_MD);
    expect(install!.contentHash).toBe(hashContent(INSTALLATION_MD));
    expect(install!.docPath).toBe('cms/installation.md');
    expect(install!.title).toBe('Installation');
    expect(install!.url).toBe(install!.docId);
  });

  it('is all additions against an empty ledger', async () => {
    const result = await driver().sync(config(), []);
    expect(result.added).toHaveLength(result.documents.length);
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });

  it('reconciles an edited, a removed and a new page against the ledger', async () => {
    const first = await driver().sync(config(), []);
    const ledger: ContextLedgerEntry[] = first.documents.map((doc) => ({
      docId: doc.docId,
      docPath: doc.docPath,
      contentHash: doc.contentHash,
    }));

    site.routes['/cms/installation.md'] = { body: `${INSTALLATION_MD}\n\n## Docker\n` };
    delete site.routes['/design-system.md'];
    site.routes['/cms/whats-new.md'] = { body: "# What's new\n\nRelease notes.\n" };
    site.routes['/llms.txt'] = {
      body: (origin) =>
        [
          '# Strapi Documentation',
          '',
          '## CMS',
          `- [Installation](${origin}/cms/installation.md)`,
          `- [What's new](${origin}/cms/whats-new.md)`,
          '',
        ].join('\n'),
      contentType: 'text/plain; charset=utf-8',
    };

    const second = await driver().sync(config(), ledger);
    expect(second.changed).toEqual([`${site.origin}/cms/installation.md`]);
    expect(second.added).toEqual([`${site.origin}/cms/whats-new.md`]);
    expect(second.removed).toContain(`${site.origin}/design-system.md`);
    expect(second.removed).not.toContain(`${site.origin}/cms/installation.md`);
  });

  it('reports an unchanged page as unchanged, not as changed', async () => {
    const first = await driver().sync(config(), []);
    const ledger: ContextLedgerEntry[] = first.documents.map((doc) => ({
      docId: doc.docId,
      docPath: doc.docPath,
      contentHash: doc.contentHash,
    }));
    const second = await driver().sync(config(), ledger);
    expect(second.unchanged).toHaveLength(first.documents.length);
    expect(second.added).toEqual([]);
    expect(second.changed).toEqual([]);
  });

  it('keeps a page on its snapshot path when a neighbour is removed', async () => {
    const first = await driver().sync(config(), []);
    // The llms.txt links this one with a fragment; the normalized URL is the identity.
    const rest = first.documents.find((doc) => doc.docId.endsWith('/cms/api/rest'))!;
    expect(rest.docPath).toBe('cms/api/rest.md');
    const ledger: ContextLedgerEntry[] = first.documents.map((doc) => ({
      docId: doc.docId,
      docPath: doc.docPath,
      contentHash: doc.contentHash,
    }));
    delete site.routes['/cms/quick-start.md'];
    const second = await driver().sync(config(), ledger);
    const restAgain = second.documents.find((doc) => doc.docId === rest.docId)!;
    expect(restAgain.docPath).toBe(rest.docPath);
  });

  it('skips an HTML-only page with its reason rather than converting it', async () => {
    const result = await driver().sync(config(), []);
    const skip = result.skipped.find((entry) => entry.ref.endsWith('/cloud/deployment'));
    expect(skip?.reason).toBe('not-markdown');
    expect(result.documents.some((doc) => doc.docId.endsWith('/cloud/deployment'))).toBe(false);
  });

  it('writes nothing to any tree', async () => {
    await driver().sync(config(), []);
    expect(fs.readdirSync(scratch)).toEqual([]);
  });

  it('names the site by its llms.txt title, so a rename lands on the source', async () => {
    const result = await driver().sync(config(), []);
    expect(result.title).toBe('Strapi Docs');
  });
});
