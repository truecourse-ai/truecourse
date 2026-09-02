import type { WebPlaceSeed, WebTree } from '../web-tree.js'

// ---------------------------------------------------------------------------
// Routes declared as JSX — React Router
//
// The one idiom whose routes are CODE, so the reading happens where the syntax
// is: `analyzer/src/extractors/web-routes.ts` composes each `<Route>` onto its
// parent and drops what composes onto nothing. What is left here is the join —
// the analyzer's per-file facts becoming places of the same registry the two
// file-system idioms feed.
// ---------------------------------------------------------------------------

/** Screens declared by React Router elements, one per route the analyzer read. */
export function readReactRouterRoutes(tree: WebTree): WebPlaceSeed[] {
  const seeds: WebPlaceSeed[] = []
  for (const analysis of tree.analyses) {
    for (const route of analysis.webRoutes ?? []) {
      seeds.push({
        kind: 'screen',
        address: route.path,
        idiom: 'react-router',
        filePath: analysis.filePath,
      })
    }
  }
  return seeds
}
