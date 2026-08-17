/**
 * The web derivation, structural half: the PLACES a navigate step can reach,
 * read off the working tree. The first web surface anything derives — every web
 * catalog that exists today was typed by a human reading the app's JSX.
 *
 * WHY THIS IS A TREE-LEVEL PASS and not a per-file extractor beside the api
 * ones. Two of the three web-routing idioms declare a route by PUTTING A FILE
 * SOMEWHERE: there is no syntax in the file to read, and the only thing that
 * distinguishes `apps/web/pages/router/index.tsx` (a screen at `/router`) from
 * `admin/src/pages/Home/HomePage.tsx` (a React component) is a `next.config.js`
 * three directories up. A per-file reader cannot see that, so it either invents
 * screens for every `pages/` directory in the world or reads none — and strapi's
 * checkout contains both traps verbatim. The gate lives where the file LIST is,
 * which is here, exactly as api mount composition lives in `api-tree.ts` rather
 * than in the analyzer.
 *
 * THE REGISTRY is ordered, and the order is the precedence: Next.js resolves an
 * app-router route before the pages-router route of the same address, and two
 * idioms naming one address are one place however many files declare it.
 *
 * SCOPE, deliberately: screens only. `InterfaceResource` also has `dialog` and
 * `panel`, and dialog primitives (`DialogContent`, `role="dialog"`) are readable
 * — the SOM experiment read five of them off this repo — but a dialog's identity
 * is the screen it opens OVER, and that `of` is a component-graph question this
 * pass cannot answer. A registry of hundreds of ownerless dialogs would be worth
 * less than none. They land with the graph pass that can place them.
 */

import { canonicalRoutePath, type FileAnalysis } from '@truecourse/shared'
import { readNextAppRoutes, readNextPagesRoutes } from './web/next-files.js'
import { readRemixFlatRoutes } from './web/remix-flat.js'
import { readReactRouterRoutes } from './web/react-router.js'

/** Which reader recognised a place — kept so a surprising address can be traced
 *  back to the convention that produced it. */
export type WebPlaceIdiom = 'next-app' | 'next-pages' | 'remix-flat' | 'react-router'

/** What an idiom reader reports: one place, at the address it is reached by. */
export interface WebPlaceSeed {
  kind: 'screen'
  /** The address, `{param}` slots — canonicalized by the registry, not the reader. */
  address: string
  idiom: WebPlaceIdiom
  /** The module that IS this place — its route file, or the file declaring it. */
  filePath: string
}

/** One place of the registry — a seed whose address has been canonicalized and
 *  whose duplicates are already folded away. */
export type WebPlace = WebPlaceSeed

/** What every reader gets: the file list, and the analyses behind it. */
export interface WebTree {
  files: readonly string[]
  analyses: readonly FileAnalysis[]
}

/** The idiom registry, in precedence order. */
const READERS: ReadonlyArray<(tree: WebTree) => WebPlaceSeed[]> = [
  readNextAppRoutes,
  readNextPagesRoutes,
  readRemixFlatRoutes,
  readReactRouterRoutes,
]

/**
 * The web places of a working tree: every idiom's reading, folded by address
 * (first reader wins) and ordered by address so the registry is stable.
 *
 * Two addresses that differ only in what they NAME a slot are ONE place, exactly
 * as they are in the api noun tree: a router cannot serve `/[user]` and
 * `/[bookingUid]` at the same position, so when both turn up they came from two
 * apps in one monorepo and the app under test has one of them. The spelling kept
 * is the first reader's.
 */
export function deriveWebPlacesFromTree(fileAnalyses: readonly FileAnalysis[]): WebPlace[] {
  const tree: WebTree = {
    files: fileAnalyses.map((analysis) => analysis.filePath),
    analyses: fileAnalyses,
  }

  const byAddress = new Map<string, WebPlace>()
  for (const read of READERS) {
    for (const seed of read(tree)) {
      const address = canonicalRoutePath(seed.address)
      const key = slotted(address)
      if (byAddress.has(key)) continue
      byAddress.set(key, { ...seed, address })
    }
  }

  // Code-unit order, not `localeCompare`: a registry is written to a committed
  // file, and locale collation treats `{` as noise — the same catalog would come
  // out ordered differently on two developers' machines.
  return [...byAddress.values()].sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))
}

/** An address with its slots anonymized — the identity two spellings share. */
function slotted(address: string): string {
  return address
    .split('/')
    .map((segment) => (segment.startsWith('{') ? '{}' : segment))
    .join('/')
}
