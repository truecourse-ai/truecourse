/**
 * A local stand-in for an llms.txt-enabled documentation site. The web-sources
 * engine is never pointed at the real internet by the suite: every test starts
 * one of these on an ephemeral port and registers it as a source.
 *
 * Routes are mutable after start (`site.routes`), which is how the refresh tests
 * publish a new page, edit one, or take one down between runs.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo, Socket } from 'node:net';
import {
  hashContent,
  readSourcesFile,
  sourceDirPath,
  writeSourcesFile,
  type SpecSource,
} from '../../packages/spec-consolidator/src/index.js';

export interface FixtureRoute {
  /** Response body. A function receives the site's own origin (llms.txt uses it). */
  body?: string | ((origin: string) => string);
  /** Defaults to `text/markdown; charset=utf-8`. */
  contentType?: string;
  status?: number;
  /** Hold the response this long — drives the per-request timeout tests. */
  delayMs?: number;
  /** Answer the first N requests with `status` before serving normally. */
  failFirst?: { times: number; status: number; retryAfter?: string };
}

export interface FixtureHit {
  path: string;
  userAgent: string | undefined;
}

export interface FixtureSite {
  origin: string;
  routes: Record<string, FixtureRoute>;
  hits: FixtureHit[];
  hitsFor(path: string): number;
  close(): Promise<void>;
}

export async function startSite(routes: Record<string, FixtureRoute>): Promise<FixtureSite> {
  const live: Record<string, FixtureRoute> = { ...routes };
  const hits: FixtureHit[] = [];
  const attempts = new Map<string, number>();
  const sockets = new Set<Socket>();
  const timers = new Set<NodeJS.Timeout>();
  let origin = 'http://127.0.0.1';

  const server = http.createServer((req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    const pathname = new URL(req.url ?? '/', origin).pathname;
    hits.push({ path: pathname, userAgent: req.headers['user-agent'] });
    const route = live[pathname];

    const send = (): void => {
      if (!route) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      const attempt = (attempts.get(pathname) ?? 0) + 1;
      attempts.set(pathname, attempt);
      if (route.failFirst && attempt <= route.failFirst.times) {
        const headers: Record<string, string> = { 'content-type': 'text/plain' };
        if (route.failFirst.retryAfter !== undefined) headers['retry-after'] = route.failFirst.retryAfter;
        res.writeHead(route.failFirst.status, headers);
        res.end('upstream is busy');
        return;
      }
      const body = typeof route.body === 'function' ? route.body(origin) : (route.body ?? '');
      res.writeHead(route.status ?? 200, {
        'content-type': route.contentType ?? 'text/markdown; charset=utf-8',
      });
      res.end(body);
    };

    if (route?.delayMs) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        send();
      }, route.delayMs);
      timers.add(timer);
      return;
    }
    send();
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    origin,
    routes: live,
    hits,
    hitsFor: (path) => hits.filter((hit) => hit.path === path).length,
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      // Keep-alive sockets would otherwise hold the close open.
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ---------------------------------------------------------------------------
// A realistic docs site: Strapi's llms.txt shape, with one page per resolution
// branch (`.md` link, `<url>.md` twin, plain markdown URL, HTML-only page).
// ---------------------------------------------------------------------------

const LLMS_TXT = (origin: string): string => `# Strapi Docs

> Strapi is the leading open-source headless CMS. It is 100% JavaScript/TypeScript,
> fully customizable, and developer-first.

## CMS

- [Quick Start Guide](/cms/quick-start.md): Create a project, model a content-type, and query it in under 10 minutes.
- [Installation](${origin}/cms/installation.md): Install Strapi with the CLI, from a template, or with Docker.
- [Content-Type Builder](${origin}/cms/content-type-builder): Model collection types, single types, and reusable components.
- [Draft & Publish](${origin}/cms/draft-and-publish): The two-stage editorial workflow for content entries.
- [REST API](${origin}/cms/api/rest#filters): Query content with filters, sort, pagination, and populate.

## Cloud

- [Deployment](${origin}/cloud/deployment): Deploy a project from a GitHub repository to Strapi Cloud.

## Optional

- [Design System](${origin}/design-system.md): The React component library the admin panel is built on.
- [GitHub Repository](https://github.com/strapi/strapi): Source code, issues, and releases.
- [Community Forum](https://forum.strapi.io): Ask questions, share plugins, and get help.
`;

export const QUICK_START_MD = `# Quick Start Guide

This guide walks you through creating a Strapi project, adding a content-type,
and fetching its entries from the REST API.

## 1. Create a project

\`\`\`bash
npx create-strapi-app@latest my-project
\`\`\`

The CLI asks whether to start with a template and which database to use. The
default (SQLite) needs no external service and is enough for local development.

## 2. Create an administrator

The first user you register at \`/admin\` becomes the super admin. This account
can never be deleted while it is the only one with the role.
`;

export const INSTALLATION_MD = `# Installation

Strapi runs on Node.js 20 or 22. Installations pin the Node major version in
\`package.json\` so that the admin panel build is reproducible across machines.

## From the CLI

\`\`\`bash
npx create-strapi-app@latest my-project --quickstart
\`\`\`

## With Docker

The official image expects the database connection to arrive through
\`DATABASE_URL\`. When it is absent the container falls back to SQLite and logs a
warning at boot.
`;

const CONTENT_TYPE_BUILDER_MD = `# Content-Type Builder

The Content-Type Builder creates and edits content-types while the server runs
in development mode. Changes are written to \`src/api/<name>/content-types\` and
trigger a server restart.

## Collection types vs single types

A collection type holds many entries (articles, products); a single type holds
exactly one (a homepage, a global setting). Both accept the same field types.

## Components

A component is a reusable group of fields. Components are stored in
\`src/components\` and can be repeated inside a dynamic zone.
`;

const DRAFT_AND_PUBLISH_MD = `# Draft & Publish

Draft & Publish gives every entry two states. A draft is only visible through
the admin panel and through the API when the request explicitly asks for it.

## Publishing an entry

Publishing sets \`publishedAt\`. The REST API returns published entries only,
unless \`status=draft\` is passed and the request carries a token allowed to read
drafts.

## Disabling the workflow

Turning Draft & Publish off for a content-type publishes every existing draft.
The operation cannot be undone from the admin panel.
`;

export const REST_API_MD = `# REST API

Every collection type is exposed at \`/api/<plural-name>\`. Responses are wrapped
in a \`data\` / \`meta\` envelope.

## Filters

Filters are expressed as query parameters:

\`\`\`
GET /api/articles?filters[title][$contains]=strapi
\`\`\`

## Pagination

\`pagination[page]\` and \`pagination[pageSize]\` page through results;
\`pagination[pageSize]\` is capped at 100 by default.
`;

const DESIGN_SYSTEM_MD = `# Design System

The Strapi Design System is the React component library the admin panel is built
on. It ships design tokens for light and dark themes and a set of accessible
primitives.

## Installing

\`\`\`bash
npm install @strapi/design-system @strapi/icons
\`\`\`

Every component must be rendered inside a \`DesignSystemProvider\`, which supplies
the theme and the locale used for date and number formatting.
`;

const DEPLOYMENT_HTML = `<!doctype html>
<html lang="en">
  <head><title>Deployment - Strapi Cloud</title></head>
  <body>
    <h1>Deployment</h1>
    <p>Connect a GitHub repository and Strapi Cloud builds it on every push.</p>
  </body>
</html>
`;

/** Route table for the realistic docs site above. */
export function docsSiteRoutes(): Record<string, FixtureRoute> {
  return {
    '/llms.txt': { body: LLMS_TXT, contentType: 'text/plain; charset=utf-8' },
    // Branch 1 — the llms.txt link already points at markdown.
    '/cms/quick-start.md': { body: QUICK_START_MD },
    '/cms/installation.md': { body: INSTALLATION_MD },
    '/design-system.md': { body: DESIGN_SYSTEM_MD },
    // Branch 2 — only the `<url>.md` twin exists.
    '/cms/content-type-builder.md': { body: CONTENT_TYPE_BUILDER_MD },
    '/cms/content-type-builder': { body: '<html><body>rendered page</body></html>', contentType: 'text/html' },
    '/cms/api/rest.md': { body: REST_API_MD },
    // Branch 3 — no twin, but the page itself serves markdown.
    '/cms/draft-and-publish': { body: DRAFT_AND_PUBLISH_MD, contentType: 'text/markdown' },
    // HTML-only — never converted, always skipped with a reason.
    '/cloud/deployment': { body: DEPLOYMENT_HTML, contentType: 'text/html; charset=utf-8' },
  };
}

/** Convenience: start the realistic docs site. */
export async function startDocsSite(): Promise<FixtureSite> {
  return startSite(docsSiteRoutes());
}

/** The llms.txt URL of a fixture site. */
export function llmsTxtUrl(site: FixtureSite): string {
  return `${site.origin}/llms.txt`;
}

// ---------------------------------------------------------------------------
// Seeding — the on-disk state `spec source add` leaves behind, without the fetch.
// Everything downstream of the fetcher (discovery, curate, the estimate, the
// staleness probe) reads only these files, so those tests need no site at all.
// ---------------------------------------------------------------------------

export interface SeedPage {
  /** Snapshot path relative to `sources/<id>/`. */
  path: string;
  /** The llms.txt link title. */
  title: string;
  body: string;
}

/** Three real pages of the fixture docs site, one per snapshot subtree shape. */
export const SEED_PAGES: SeedPage[] = [
  { path: 'cms/quick-start.md', title: 'Quick Start Guide', body: QUICK_START_MD },
  { path: 'cms/installation.md', title: 'Installation', body: INSTALLATION_MD },
  { path: 'cms/api/rest.md', title: 'REST API', body: REST_API_MD },
];

export interface SeedSourceOptions {
  id?: string;
  title?: string;
  /** Origin the page URLs are built from. */
  origin?: string;
  pages?: SeedPage[];
}

/**
 * Write a source snapshot plus its registry entry into `repoRoot`, replacing any
 * entry with the same id. Returns the registered source.
 */
export function seedSource(repoRoot: string, opts: SeedSourceOptions = {}): SpecSource {
  const id = opts.id ?? 'docs.strapi.io';
  const origin = opts.origin ?? `https://${id}`;
  const pages = opts.pages ?? SEED_PAGES;
  const dir = sourceDirPath(repoRoot, id);

  const docs = pages.map((page) => {
    const abs = path.join(dir, page.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, page.body);
    return {
      url: `${origin}/${page.path}`,
      path: page.path,
      title: page.title,
      contentHash: hashContent(page.body),
    };
  });

  const source: SpecSource = {
    id,
    llmsTxtUrl: `${origin}/llms.txt`,
    title: opts.title ?? 'Strapi Docs',
    fetchedAt: new Date().toISOString(),
    docs,
    skipped: [],
  };
  const registry = readSourcesFile(repoRoot);
  writeSourcesFile(repoRoot, {
    version: 1,
    sources: [...registry.sources.filter((entry) => entry.id !== id), source],
  });
  return source;
}
