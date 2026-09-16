/**
 * Routes declared as a FILENAME — the remix flat-routes grammar (React Router v7
 * keeps it, and documenso is written entirely in it). The whole address lives in
 * the file's NAME, with `.` as the separator that `/` would be:
 *
 *     app/routes/_authenticated+/t.$teamUrl+/documents.$id.edit.tsx
 *                                                → /t/{teamUrl}/documents/{id}/edit
 *
 * The grammar, token by token, `.`-separated and read left to right:
 *
 *  - `$name` is a slot → `{name}`. A BARE `$` is a splat, and a splat is not a
 *    place: it is the fallback that catches whatever no place matched.
 *  - a leading `_` makes a token PATHLESS — `_authenticated` wraps its children
 *    in a layout and contributes no segment, and `_index` is the index route of
 *    the address its siblings build. `_layout` is the layout MODULE itself, so
 *    the file is not a screen at all.
 *  - a TRAILING `_` (`authoring_.completed`) opts the segment out of its parent
 *    layout without changing the address; the underscore is not part of it.
 *  - `[...]` escapes literal characters, which is how a segment gets to contain
 *    a dot or start with an underscore (`[__htmltopdf]`).
 *  - a DIRECTORY ending in `+` is the same grammar spelled as a folder — it
 *    exists so long addresses can be grouped, and its name (minus the `+`) is
 *    read exactly like a filename. A directory WITHOUT the `+` is colocation,
 *    not routing: components living beside the route that uses them, and
 *    emitting screens for those is how a reader would go wrong.
 *
 * Shared so the interface mapper's screens and the recipe proposer's web health
 * path read ONE grammar; who decides a `routes/` tree IS a flat-routes tree is
 * each caller's own business.
 */

/** The file extensions flat-routes resolves a route module at. */
export const REMIX_ROUTE_FILE = /\.(?:tsx|jsx|ts|js|mjs)$/

/**
 * The address segments of one route module, given its path RELATIVE to the
 * `routes/` directory, or `null` when the file is not a screen: a layout, a
 * splat, or a file colocated in a non-`+` directory.
 */
export function remixFlatSegments(relative: readonly string[]): string[] | null {
  const fileName = relative[relative.length - 1]
  if (!fileName || !REMIX_ROUTE_FILE.test(fileName)) return null

  const tokens: string[] = []
  for (const directory of relative.slice(0, -1)) {
    if (!directory.endsWith('+')) return null // colocation, not routing
    tokens.push(...splitTokens(directory.slice(0, -1)))
  }
  tokens.push(...splitTokens(fileName.replace(REMIX_ROUTE_FILE, '')))

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
function splitTokens(name: string): string[] {
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
