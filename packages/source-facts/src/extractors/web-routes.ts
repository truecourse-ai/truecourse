import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { SupportedLanguage, WebRoute } from '@truecourse/shared'

// ---------------------------------------------------------------------------
// Web routes declared as JSX — React Router
//
// Of the three web-routing idioms, this is the only one written as CODE. Next.js
// and remix-flat-routes declare a screen by PUTTING A FILE SOMEWHERE, so there is
// nothing in the file to read; their addresses come out of the file list in
// `interface-mapper/web-tree.ts`, which is also the only place the framework
// roots that gate them are visible. This reader covers the third:
//
//     <Routes>
//       <Route path="/" element={<HomePage />} />
//       <Route path="/repos/:repoId" element={<RepoPage />} />
//     </Routes>
//
// TWO GATES, both learned from the api extractor's receiver gate:
//
//  1. **The file must import React Router.** `Route` is an ordinary component
//     name — leaflet draws one, an SVG legend can render one — and a file that
//     never imported the library is not declaring the app's routes whatever it
//     calls its elements. The import is the cheapest possible proof, and unlike a
//     name blocklist it does not lose to the next library published.
//
//  2. **The address must be ABSOLUTE.** React Router composes a nested `<Route>`
//     onto its parent, so a child fragment is composed here and emitted whole. A
//     fragment that composes onto NOTHING — the shape a plugin's route table
//     takes, mounted somewhere the file does not name — is dropped rather than
//     emitted bare. This is the api extractor's rule transplanted: an
//     unaddressable route is not a lesser version of a route, it is a place no
//     navigate step can ever reach, and two of them collapse onto one key and
//     silently become one.
//
// WHAT IS DELIBERATELY NOT READ. The `RouteObject[]` data form
// (`{ path: ':collectionType/:slug', Component }`, react-router's data routers)
// is the same idiom expressed as literals, and strapi's admin panel is written
// entirely in it — but every table there is relative to a mount the file does not
// state, and the app's own basename comes from an env var read at runtime
// (`process.env.ADMIN_PATH`). Reading the tables would therefore produce nothing
// addressable, and gating "an object with a `path` key" is far weaker than gating
// a JSX element name. Composing those mounts is a slice of its own, and it needs
// a declared web base path to land on.
// ---------------------------------------------------------------------------

/** The packages whose presence proves `<Route>` means what it looks like. */
const REACT_ROUTER_MODULES = new Set(['react-router', 'react-router-dom'])

/** The languages JSX can appear in. */
const JSX_LANGUAGES = new Set<SupportedLanguage>(['tsx', 'javascript'])

/**
 * The routes a React Router file declares, each at the absolute address the app
 * serves it from. Empty for every file that is not one.
 */
export function extractWebRoutes(
  tree: Tree,
  filePath: string,
  language: SupportedLanguage,
): WebRoute[] {
  if (!JSX_LANGUAGES.has(language)) return []
  if (!importsReactRouter(tree)) return []

  const routes: WebRoute[] = []
  walkRoutes(tree.rootNode, undefined, (node, address) => {
    routes.push({ path: address, location: locate(node, filePath) })
  })
  return routes
}

/**
 * Every `<Route>` element below `node`, in source order, with the address it
 * composes to. `inherited` is the nearest enclosing Route's address — the only
 * thing a relative child can be resolved against.
 */
function walkRoutes(
  node: SyntaxNode,
  inherited: string | undefined,
  emit: (node: SyntaxNode, address: string) => void,
): void {
  const opening = routeElement(node)
  let childInherited = inherited

  if (opening) {
    const declared = attributeString(opening, 'path')
    const address = declared === null ? null : compose(inherited, declared)
    // A pathless `<Route>` is a layout: it contributes no address of its own and
    // does not reset what its children inherit.
    if (declared !== null && address !== null) {
      emit(opening, address)
      childInherited = address
    }
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child) walkRoutes(child, childInherited, emit)
  }
}

/** `/settings` + `members` → `/settings/members`; a fragment with no absolute
 *  parent → `null` (see the module note). */
function compose(inherited: string | undefined, declared: string): string | null {
  if (declared.startsWith('/')) return normalize(declared)
  if (inherited === undefined) return null
  return normalize(`${inherited}/${declared}`)
}

function normalize(path: string): string {
  const collapsed = path.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return collapsed || '/'
}

/** The opening element of `<Route …>` / `<Route …/>`, or `null`. */
function routeElement(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'jsx_self_closing_element') return elementName(node) === 'Route' ? node : null
  if (node.type !== 'jsx_element') return null
  const opening = node.namedChild(0)
  if (!opening || opening.type !== 'jsx_opening_element') return null
  return elementName(opening) === 'Route' ? opening : null
}

/** `<Route>` → `Route`, `<Router.Route>` → `Route`. */
function elementName(element: SyntaxNode): string | null {
  const name = element.childForFieldName('name')
  if (!name) return null
  if (name.type === 'member_expression') return name.childForFieldName('property')?.text ?? null
  return name.text
}

/** A JSX attribute's STRING value; `null` when it is absent or an expression
 *  (`path={path}` names a route only the running app knows). */
function attributeString(element: SyntaxNode, attribute: string): string | null {
  for (let i = 0; i < element.namedChildCount; i++) {
    const attr = element.namedChild(i)
    if (attr?.type !== 'jsx_attribute') continue
    if (attr.namedChild(0)?.text !== attribute) continue
    const value = attr.namedChild(1)
    if (!value) return null
    return value.type === 'string' ? stringLiteral(value) : null
  }
  return null
}

function stringLiteral(node: SyntaxNode): string | null {
  const fragment = node.namedChildren.find((child) => child?.type === 'string_fragment')
  if (fragment) return fragment.text
  // `path=""` parses as a string with no fragment child.
  return node.text.length >= 2 ? '' : null
}

/** Does this file import React Router at all — the gate. */
function importsReactRouter(tree: Tree): boolean {
  const cursor = tree.walk()
  let found = false

  function traverse(): void {
    if (found) return
    const node = cursor.currentNode
    if (node.type === 'import_statement') {
      const source = node.childForFieldName('source')
      const text = source ? stringLiteral(source) : null
      if (text !== null && REACT_ROUTER_MODULES.has(text)) {
        found = true
        return
      }
    }
    if (cursor.gotoFirstChild()) {
      do {
        traverse()
      } while (!found && cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }

  traverse()
  return found
}

function locate(node: SyntaxNode, filePath: string): WebRoute['location'] {
  return {
    filePath,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  }
}
