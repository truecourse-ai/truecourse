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
// THE GATE is `next.config.*`. Without it this reader is a menace: `pages/` is
// one of the most common directory names in a React codebase and `page.tsx` one
// of the most common filenames. strapi's admin panel keeps 40-odd components
// under `admin/src/pages/`, and an ungated reader turns every one of them into a
// screen at an address the app has never served. So a router root is only a
// router root when a Next.js config file sits at its app root — and the NEAREST
// such config wins, which is what makes this correct in a monorepo where several
// apps each have their own.
// ---------------------------------------------------------------------------

/** The file extensions Next.js resolves a route file at. */
const ROUTE_FILE = /\.(?:tsx|jsx|ts|js|mjs)$/

/** What claims an app root — any of the config filenames Next.js accepts. */
const NEXT_CONFIG = /^next\.config\.(?:js|mjs|cjs|ts|mts)$/

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
    const root = nearestRoot(roots, filePath)
    if (root === null) continue
    const segments = segmentsOf(filePath.slice(root.length + 1).split('/'))
    if (segments === null) continue
    seeds.push({ kind: 'screen', address: `/${segments.join('/')}`, idiom, filePath })
  }
  return seeds
}

/**
 * The `<app-root>/{,src/}<router>` directories of every Next.js app in the tree.
 * Longest first, so the nearest config wins for a file several apps could claim.
 */
function nextRouterRoots(tree: WebTree, router: 'app' | 'pages'): string[] {
  const roots: string[] = []
  for (const filePath of tree.files) {
    const cut = filePath.lastIndexOf('/')
    if (cut < 0 || !NEXT_CONFIG.test(filePath.slice(cut + 1))) continue
    const appRoot = filePath.slice(0, cut)
    roots.push(`${appRoot}/${router}`, `${appRoot}/src/${router}`)
  }
  return [...new Set(roots)].sort((a, b) => b.length - a.length)
}

/** The root this file is served by, or `null` when no router owns it. */
function nearestRoot(roots: readonly string[], filePath: string): string | null {
  return roots.find((root) => filePath.startsWith(`${root}/`)) ?? null
}

/**
 * The address segments of an app-router file, or `null` when the file is not a
 * routable screen (see the conventions in the module note).
 */
function appSegments(relative: string[]): string[] | null {
  const fileName = relative[relative.length - 1]
  if (!fileName || !/^page\.(?:tsx|jsx|ts|js|mjs)$/.test(fileName)) return null

  const segments: string[] = []
  for (const directory of relative.slice(0, -1)) {
    if (directory.startsWith('_') || directory.startsWith('@')) return null
    if (/^\((?:\.{1,3})\)/.test(directory)) return null // an interception, not a place
    if (/^\(.*\)$/.test(directory)) continue // a group organizes, it does not address
    const segment = dynamicSegment(directory)
    if (segment !== null) segments.push(segment)
  }
  return segments
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
    const segment = dynamicSegment(directory)
    if (segment !== null) segments.push(segment)
  }
  const leaf = dynamicSegment(fileName.replace(ROUTE_FILE, ''))
  if (leaf !== null && leaf !== 'index') segments.push(leaf)
  return segments
}

/**
 * One directory name as an address segment: a slot becomes `{name}`, a catch-all
 * `{...name}`, and an OPTIONAL catch-all becomes nothing at all — it matches its
 * own parent, so the address it yields is the parent's.
 */
function dynamicSegment(name: string): string | null {
  const optionalCatchAll = /^\[\[\.\.\.(.+)\]\]$/.exec(name)
  if (optionalCatchAll) return null
  const catchAll = /^\[\.\.\.(.+)\]$/.exec(name)
  if (catchAll) return `{...${catchAll[1]}}`
  const slot = /^\[(.+)\]$/.exec(name)
  if (slot) return `{${slot[1]}}`
  return name
}
