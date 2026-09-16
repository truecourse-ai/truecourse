import { remixFlatSegments } from '@truecourse/shared'
import type { WebPlaceSeed, WebTree } from '../web-tree.js'

// ---------------------------------------------------------------------------
// Routes declared as a FILENAME — remix-flat-routes
//
// The grammar itself lives in `@truecourse/shared` (`remixFlatSegments`), which
// the recipe proposer's web health path reads too. What belongs HERE is the
// GATE: `routes/` is far too common a directory name to read on sight — strapi
// keeps React Router tables in `admin/src/routes/`, and every Express app in the
// world has one — so a tree is only a flat-routes tree when a sibling `routes.ts`
// IMPORTS `remix-flat-routes`. That is the app stating the convention in its own
// words, and it is exactly the fact `FileAnalysis.imports` already carries.
// ---------------------------------------------------------------------------

/** The package whose import claims a `routes/` tree. */
const FLAT_ROUTES_PACKAGE = 'remix-flat-routes'

/** The config module the app declares its routing in. */
const ROUTES_CONFIG = /^routes\.(?:tsx|jsx|ts|js|mjs)$/

/** Screens of a remix-flat-routes tree — one per route module. */
export function readRemixFlatRoutes(tree: WebTree): WebPlaceSeed[] {
  const roots = flatRoutesRoots(tree)
  if (roots.length === 0) return []

  const seeds: WebPlaceSeed[] = []
  for (const filePath of tree.files) {
    const root = roots.find((candidate) => filePath.startsWith(`${candidate}/`))
    if (!root) continue
    const segments = remixFlatSegments(filePath.slice(root.length + 1).split('/'))
    if (segments === null) continue
    seeds.push({ kind: 'screen', address: `/${segments.join('/')}`, idiom: 'remix-flat', filePath })
  }
  return seeds
}

/** The `routes/` directory of every app whose config imports flat-routes. */
function flatRoutesRoots(tree: WebTree): string[] {
  const roots: string[] = []
  for (const analysis of tree.analyses) {
    const cut = analysis.filePath.lastIndexOf('/')
    if (cut < 0 || !ROUTES_CONFIG.test(analysis.filePath.slice(cut + 1))) continue
    if (!analysis.imports.some((imported) => imported.source === FLAT_ROUTES_PACKAGE)) continue
    roots.push(`${analysis.filePath.slice(0, cut)}/routes`)
  }
  return [...new Set(roots)].sort((a, b) => b.length - a.length)
}
