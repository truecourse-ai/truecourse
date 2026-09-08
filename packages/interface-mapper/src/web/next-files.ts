import { nextRouterRoots, nearestNextRoot, nextAppSegments, nextDynamicSegment } from '@truecourse/shared'
import type { WebPlaceSeed, WebTree } from '../web-tree.js'

// ---------------------------------------------------------------------------
// Routes declared as a DIRECTORY — Next.js
//
// Next.js has no route table and no route call. A screen exists because a file
// named `page.tsx` sits in a directory, and the directory path IS the address:
//
//     apps/web/app/(booking-page-wrapper)/[user]/[type]/page.tsx  →  /{user}/{type}
//
// which makes this the highest-recall reader in the registry and the one that
// needs no syntax at all. Everything it has to get right is naming convention,
// and the conventions are precise:
//
//  - `(name)` is a ROUTE GROUP — a directory that organizes files and
//    contributes NOTHING to the address. cal.diy nests three of them.
//  - `[param]` is a slot, `[...param]` a catch-all, `[[...param]]` an OPTIONAL
//    catch-all — which matches its own parent, so the address it yields is the
//    parent's (`app/[[...mdxPath]]/page.tsx` serves `/`).
//  - `_name` is a PRIVATE folder and `@name` a parallel SLOT: neither is
//    routable on its own. `(.)`, `(..)`, `(...)` prefixes are INTERCEPTING
//    routes — a second rendering of a screen that already exists elsewhere, so
//    reading them would mint the same place twice under a fake address.
//  - `route.ts` is an HTTP handler, not a screen. It never matches `page.*`, so
//    it is excluded by construction rather than by a rule — and `pages/api/**`,
//    which is not, is excluded explicitly below.
//
// THE GATE is `next.config.*` or a manifest declaring Next.js. `pages/` is
// one of the most common directory names in a React codebase and `page.tsx` one
// of the most common filenames. strapi's admin panel keeps 40-odd components
// under `admin/src/pages/`, and an ungated reader turns every one of them into a
// screen at an address the app has never served. So a router root is only a
// router root when a config or dependency identifies its app root. The NEAREST
// root wins, which is what makes this correct in a monorepo where several
// apps each have their own.
// ---------------------------------------------------------------------------

/** The file extensions Next.js resolves a route file at. */
const ROUTE_FILE = /\.(?:tsx|jsx|ts|js|mjs)$/

/** Screens of the APP router — one per `page.*`. */
export function readNextAppRoutes(tree: WebTree): WebPlaceSeed[] {
  return readNextRoutes(tree, 'app', 'next-app', appSegments)
}

/** Screens of the PAGES router — one per routable file. */
export function readNextPagesRoutes(tree: WebTree): WebPlaceSeed[] {
  return readNextRoutes(tree, 'pages', 'next-pages', pagesSegments)
}

function readNextRoutes(
  tree: WebTree,
  router: 'app' | 'pages',
  idiom: WebPlaceSeed['idiom'],
  segmentsOf: (relative: string[]) => string[] | null,
): WebPlaceSeed[] {
  const roots = nextRouterRoots(tree, router)
  if (roots.length === 0) return []

  const seeds: WebPlaceSeed[] = []
  for (const filePath of tree.files) {
    const root = nearestNextRoot(roots, filePath)
    if (root === null) continue
    const segments = segmentsOf(filePath.slice(root.length + 1).split('/'))
    if (segments === null) continue
    seeds.push({ kind: 'screen', address: `/${segments.join('/')}`, idiom, filePath })
  }
  return seeds
}

/**
 * The address segments of an app-router file, or `null` when the file is not a
 * routable screen (see the conventions in the module note).
 */
function appSegments(relative: string[]): string[] | null {
  const fileName = relative[relative.length - 1]
  if (!fileName || !/^page\.(?:tsx|jsx|ts|js|mjs)$/.test(fileName)) return null

  return nextAppSegments(relative.slice(0, -1))
}

/**
 * The address segments of a pages-router file. `index` addresses its own
 * directory; `_app` / `_document` / `_error` are the framework's own modules and
 * `pages/api/**` is the HTTP surface, not the web one.
 */
function pagesSegments(relative: string[]): string[] | null {
  const fileName = relative[relative.length - 1]
  if (!fileName || !ROUTE_FILE.test(fileName)) return null
  if (fileName.startsWith('_')) return null
  if (relative[0] === 'api') return null

  const segments: string[] = []
  for (const directory of relative.slice(0, -1)) {
    const segment = nextDynamicSegment(directory)
    if (segment !== null) segments.push(segment)
  }
  const leaf = nextDynamicSegment(fileName.replace(ROUTE_FILE, ''))
  if (leaf !== null && leaf !== 'index') segments.push(leaf)
  return segments
}
