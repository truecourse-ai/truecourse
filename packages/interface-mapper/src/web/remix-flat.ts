import type { WebPlaceSeed, WebTree } from '../web-tree.js'

// ---------------------------------------------------------------------------
// Routes declared as a FILENAME — remix-flat-routes
//
// Remix's flat-routes convention (React Router v7 keeps it, and documenso is
// written entirely in it) puts the whole address in the file's NAME, with `.` as
// the separator that `/` would be:
//
//     app/routes/_authenticated+/t.$teamUrl+/documents.$id.edit.tsx
//                                                → /t/{teamUrl}/documents/{id}/edit
//
// The grammar, token by token, `.`-separated and read left to right:
//
//  - `$name` is a slot → `{name}`. A BARE `$` is a splat, and a splat is not a
//    place: it is the fallback that catches whatever no place matched.
//  - a leading `_` makes a token PATHLESS — `_authenticated` wraps its children
//    in a layout and contributes no segment, and `_index` is the index route of
//    the address its siblings build. `_layout` is the layout MODULE itself, so
//    the file is not a screen at all.
//  - a TRAILING `_` (`authoring_.completed`) opts the segment out of its parent
//    layout without changing the address; the underscore is not part of it.
//  - `[...]` escapes literal characters, which is how a segment gets to contain
//    a dot or start with an underscore (`[__htmltopdf]`).
//  - a DIRECTORY ending in `+` is the same grammar spelled as a folder — it
//    exists so long addresses can be grouped, and its name (minus the `+`) is
//    read exactly like a filename. A directory WITHOUT the `+` is colocation,
//    not routing: components living beside the route that uses them, and
//    emitting screens for those is how this reader would go wrong.
//
// THE GATE is the app's own routes config. `routes/` is far too common a
// directory name to read on sight — strapi keeps React Router tables in
// `admin/src/routes/`, and every Express app in the world has one — so a tree is
// only a flat-routes tree when a sibling `routes.ts` IMPORTS `remix-flat-routes`.
// That is the app stating the convention in its own words, and it is exactly the
// fact `FileAnalysis.imports` already carries.
// ---------------------------------------------------------------------------

/** The package whose import claims a `routes/` tree. */
const FLAT_ROUTES_PACKAGE = 'remix-flat-routes'

/** The config module the app declares its routing in. */
const ROUTES_CONFIG = /^routes\.(?:tsx|jsx|ts|js|mjs)$/

/** The file extensions flat-routes resolves a route module at. */
const ROUTE_FILE = /\.(?:tsx|jsx|ts|js|mjs)$/

/** Screens of a remix-flat-routes tree — one per route module. */
export function readRemixFlatRoutes(tree: WebTree): WebPlaceSeed[] {
  const roots = flatRoutesRoots(tree)
  if (roots.length === 0) return []

  const seeds: WebPlaceSeed[] = []
  for (const filePath of tree.files) {
    const root = roots.find((candidate) => filePath.startsWith(`${candidate}/`))
    if (!root) continue
    const segments = routeSegments(filePath.slice(root.length + 1).split('/'))
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

/**
 * The address segments of one route module, or `null` when the file is not a
 * screen: a layout, a splat, or a file colocated in a non-`+` directory.
 */
function routeSegments(relative: string[]): string[] | null {
  const fileName = relative[relative.length - 1]
  if (!fileName || !ROUTE_FILE.test(fileName)) return null

  const tokens: string[] = []
  for (const directory of relative.slice(0, -1)) {
    if (!directory.endsWith('+')) return null // colocation, not routing
    tokens.push(...split(directory.slice(0, -1)))
  }
  tokens.push(...split(fileName.replace(ROUTE_FILE, '')))

  const segments: string[] = []
  for (const [index, token] of tokens.entries()) {
    const last = index === tokens.length - 1
    if (token === 'layout' || token === '_layout') return null // the layout module itself
    if (token === '$') return null // a splat catches what no place matched
    if (last && (token === 'route' || token === 'index' || token === 'page')) continue
    if (token.startsWith('_')) continue // pathless: a layout wrap, or the index route
    const escaped = /^\[(.*)\]$/.exec(token)
    if (escaped) {
      segments.push(escaped[1]!)
      continue
    }
    const trimmed = token.endsWith('_') ? token.slice(0, -1) : token
    segments.push(trimmed.startsWith('$') ? `{${trimmed.slice(1)}}` : trimmed)
  }
  return segments
}

/** Split one name on the separator dots, leaving the `[…]`-escaped ones alone. */
function split(name: string): string[] {
  const tokens: string[] = []
  let current = ''
  let escaped = false
  for (const char of name) {
    if (char === '[') escaped = true
    else if (char === ']') escaped = false
    if (char === '.' && !escaped) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}
