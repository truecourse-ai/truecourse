import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { RouteRegistration, RouterMount } from '@truecourse/shared'

// ---------------------------------------------------------------------------
// Routes declared as data — Strapi route tables
//
// Strapi never calls a router either. A route module exports a TABLE, and the
// server walks it at boot:
//
//     export const routes = {
//       type: 'admin',
//       routes: [
//         { method: 'GET', path: '/settings', handler: 'admin-settings.getSettings',
//           config: { policies: ['admin::isAuthenticatedAdmin'] } },
//       ],
//     }
//
// Reading the literals is the easy half. The address is the hard half, because
// `/settings` is not where that route is served — `/upload/settings` is — and a
// route emitted at its bare path is worse than no route at all: it is not
// callable, and two plugins that both declare `/settings` collide onto one
// operation key and silently become one.
//
// THE COMPOSITION RULE. Strapi stacks three Koa routers
// (`packages/core/core/src/services/server/`), and the served path is the sum:
//
//     servedPath = apiPrefix(type) + routerPrefix + route.path
//
//  - `apiPrefix` is `''` for `type: 'admin'` (`admin-api.ts:5-8` — the `/admin`
//    there is commented out) and `/api` for `type: 'content-api'`
//    (`content-api.ts:6`, `api.rest.prefix`, default `/api`).
//  - `routerPrefix` is `/${pluginName}` for every plugin router
//    (`register-routes.ts:70,80`) and a hardcoded `/admin` for the admin package
//    (`register-routes.ts:42`). Both are `??` defaults an explicit router-level
//    `prefix` can override, which is why an explicit one is honoured below.
//  - a route carrying `config.prefix` is attached to the PARENT api router
//    instead of the plugin's (`routing.ts:110-111`), so it keeps `apiPrefix` and
//    loses `routerPrefix` — this is how users-permissions serves `/api/auth/local`
//    rather than `/api/users-permissions/auth/local`. Strapi reads the field's
//    PRESENCE, not its value, and every value in the wild is `''`.
//
// The plugin name is `package.json → strapi.name`, which the analyzer cannot
// read from inside a route file — but it equals the package directory in every
// case, so it is taken from the path (`ownerOf`). That is also the gate: a file
// that is not `…/<owner>/server/**/routes/**` is not a Strapi route module and
// nothing is emitted for it. It keeps frontend route tables out
// (`*/admin/src/routes/*` is React Router) and it keeps this reader silent in
// every repo that is not a Strapi app.
//
// WHEN THE TYPE LIVES IN ANOTHER FILE. Half of Strapi's route modules export a
// bare array and let a sibling `index` wrap it in the typed group
// (`export default [ {…} ]` in `admin-tokens.ts`, spread into
// `{ type: 'admin', routes: [...adminTokens] }` in `index.ts`). The prefix is
// genuinely not in the file, so it is not invented: the module registers BARE
// paths and the index emits a RouterMount per spread identifier at the composed
// prefix. That is exactly the existing mount machinery
// (`interface-mapper/api-tree.ts`), which already resolves a mounted name to the
// analyzed file it was imported from — the same path Express routers take.
//
// The one thing that must not happen is a bare path with nothing to mount it, so
// an untyped array registers only when it is a MODULE-LEVEL export. A route array
// built inside a function (`module.exports = (strapi) => [...]`,
// `createContentApiRoutesFactory(() => [...])`) belongs to whoever calls the
// factory, and its callers spread call results rather than names — nothing could
// mount it, so it stays unread. The single exception is the factory itself, which
// hardcodes `type: 'content-api'` (`utils/src/content-api-router.ts:19`) and so
// IS a typed group; its callback body is read as one.
//
// Two layouts answer the type where the file does not — see `untypedPrefix`.
//
// `config.policies` IS NOT CAPTURED, and not for want of trying: it is the best
// auth grounding in the file — `'admin::isAuthenticatedAdmin'` is precisely what
// the hand-authored contracts wrote as `Authorization: Bearer <admin JWT>` — but
// `RouteRegistration` has nowhere to put it. The only optional field it carries
// is `requestContract`, which describes the request BODY and QUERY (and, since
// the 2f extension, the response side) and has no notion of a credential.
// Carrying policies needs a field of its own.
//
// WHAT IS DELIBERATELY NOT DERIVED, because none of it is a route table:
// the per-content-type CRUD Strapi GENERATES at boot (`core-api/routes/index.ts`),
// and everything registered imperatively onto the root router — the MCP endpoints,
// `/graphql`, `/_health`, the admin panel's static catch-all.
// ---------------------------------------------------------------------------

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL'])

/** The routers Strapi mounts the two api-level prefixes on. */
const API_PREFIX: Record<string, string> = {
  admin: '',
  'content-api': '/api',
}

/** Strapi's own helper, whose callback returns a `type: 'content-api'` table. */
const CONTENT_API_FACTORY = 'createContentApiRoutesFactory'

/**
 * Route registrations and router mounts declared by Strapi route tables. Paths
 * come out fully composed EXCEPT for an untyped module-level array, which
 * registers bare paths and is addressed by the mount its index emits.
 */
export function extractStrapiRouteTables(
  tree: Tree,
  filePath: string,
): { routes: RouteRegistration[]; mounts: RouterMount[] } {
  const owner = ownerOf(filePath)
  if (owner === null) return { routes: [], mounts: [] }

  const routes: RouteRegistration[] = []
  const mounts: RouterMount[] = []
  // A typed group's `routes:` array is usually module-level too, so the second
  // pass has to be told which arrays the first one already addressed.
  const claimed = new Set<number>()

  for (const group of typedGroups(tree, owner)) {
    for (const array of group.arrays) {
      if (claimed.has(array.id)) continue
      claimed.add(array.id)
      readArray(array, group.prefix, filePath, routes, mounts)
    }
  }

  const untyped = untypedPrefix(filePath, owner)
  for (const array of moduleLevelArrays(tree)) {
    if (claimed.has(array.id)) continue
    claimed.add(array.id)
    readArray(array, untyped, filePath, routes, mounts)
  }

  return { routes, mounts }
}

/** The two halves of a served address, kept apart because `config.prefix` drops one. */
interface Prefix {
  /** `''` for admin, `/api` for content-api. Survives `config.prefix`. */
  api: string
  /** `/<plugin>`. Dropped by `config.prefix`. */
  router: string
}

/**
 * The plugin (or package) a route module belongs to — the name Strapi mounts it
 * under. `null` means "not a Strapi route module", which is the gate.
 *
 * The layout is always `…/<owner>/server/**​/routes/**`, with an optional `ee`
 * directory between the owner and `server` for enterprise-only routers.
 */
function ownerOf(filePath: string): string | null {
  const segments = filePath.split('/')
  const serverAt = segments.lastIndexOf('server')
  if (serverAt < 1) return null
  if (!segments.slice(serverAt + 1).includes('routes')) return null
  const owner = segments[serverAt - 1] === 'ee' ? segments[serverAt - 2] : segments[serverAt - 1]
  return owner && owner !== 'src' ? owner : null
}

/**
 * Where a route array whose file names no `type` is served — the two cases where
 * the layout answers what the file does not:
 *
 *  - `routes/<admin|content-api>/<module>` — Strapi's directory form of the
 *    `routes/admin.ts` / `routes/content-api.ts` split. The DIRECTORY only: the
 *    file form is not read this way, because `admin/server/src/routes/content-api.ts`
 *    is the admin router's routes ABOUT the content api, served at `/admin`.
 *  - `routes/index` — a plugin exporting a bare array is wrapped as
 *    `{ type: 'admin', prefix: '/<plugin>' }` (`register-routes.ts:68-72`).
 *
 * Otherwise the address lives in a sibling index, and the empty prefix leaves the
 * paths bare for the mount that index emits to compose.
 */
function untypedPrefix(filePath: string, owner: string): Prefix {
  const type = routesGroupDirectory(filePath) ?? (isRoutesIndex(filePath) ? 'admin' : null)
  return type ? { api: API_PREFIX[type]!, router: `/${owner}` } : { api: '', router: '' }
}

/** `…/routes/admin/role.js` → `admin`; `…/routes/admin.ts` → `null` (a file, not a group). */
function routesGroupDirectory(filePath: string): string | null {
  const segments = filePath.split('/')
  const routesAt = segments.lastIndexOf('routes')
  const next = segments[routesAt + 1]
  if (routesAt < 0 || next === undefined || routesAt + 2 >= segments.length) return null
  return API_PREFIX[next] !== undefined ? next : null
}

function isRoutesIndex(filePath: string): boolean {
  const base = filePath.split('/').pop() ?? ''
  return /^index\.[cm]?[jt]sx?$/.test(base)
}

/**
 * Every typed route group in the file, with the prefix it serves at: an object
 * literal carrying BOTH a string-literal `type` and a `routes` array, plus the
 * callback of a `createContentApiRoutesFactory(…)` call, which is a content-api
 * group with its `type` hardcoded in Strapi rather than written here.
 */
function typedGroups(tree: Tree, owner: string): Array<{ prefix: Prefix; arrays: SyntaxNode[] }> {
  const groups: Array<{ prefix: Prefix; arrays: SyntaxNode[] }> = []
  const cursor = tree.walk()

  function traverse(): void {
    const node = cursor.currentNode

    if (node.type === 'object') {
      const type = objectStringProperty(node, 'type')
      const routesArray = objectProperty(node, 'routes')
      if (type !== null && API_PREFIX[type] !== undefined && routesArray?.type === 'array') {
        // An explicit router-level `prefix` overrides `/<plugin>` everywhere the
        // loader defaults it (`register-routes.ts:80`).
        const explicit = objectStringProperty(node, 'prefix')
        groups.push({
          prefix: { api: API_PREFIX[type]!, router: explicit ?? `/${owner}` },
          arrays: [routesArray],
        })
      }
    } else if (node.type === 'call_expression' && calleeName(node) === CONTENT_API_FACTORY) {
      groups.push({
        prefix: { api: API_PREFIX['content-api']!, router: `/${owner}` },
        arrays: descendantArrays(node),
      })
    }

    if (cursor.gotoFirstChild()) {
      do { traverse() } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }

  traverse()
  return groups
}

/**
 * Array literals reachable from the program root without crossing a function or
 * a call — i.e. the value of a module-level export. See the module note: an array
 * built inside a function belongs to its caller, not to this file.
 */
function moduleLevelArrays(tree: Tree): SyntaxNode[] {
  const arrays: SyntaxNode[] = []
  const cursor = tree.walk()

  function traverse(): void {
    const type = cursor.nodeType
    if (
      type === 'arrow_function' ||
      type === 'function_expression' ||
      type === 'function_declaration' ||
      type === 'generator_function_declaration' ||
      type === 'method_definition' ||
      type === 'call_expression'
    ) {
      return
    }
    if (type === 'array') {
      arrays.push(cursor.currentNode)
      return
    }
    if (cursor.gotoFirstChild()) {
      do { traverse() } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }

  traverse()
  return arrays
}

/** Every array literal below `node`, however deep. */
function descendantArrays(node: SyntaxNode): SyntaxNode[] {
  const arrays: SyntaxNode[] = []
  const stack = [node]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (let i = 0; i < current.namedChildCount; i++) {
      const child = current.namedChild(i)
      if (!child) continue
      if (child.type === 'array') arrays.push(child)
      stack.push(child)
    }
  }
  return arrays
}

/**
 * Read one `routes: [...]` array: route objects become registrations, spread
 * identifiers become mounts at this group's prefix — that is how a route module
 * whose own file names no type gets its address.
 */
function readArray(
  array: SyntaxNode,
  prefix: Prefix,
  filePath: string,
  routes: RouteRegistration[],
  mounts: RouterMount[],
): void {
  for (let i = 0; i < array.namedChildCount; i++) {
    const element = array.namedChild(i)
    if (!element) continue

    if (element.type === 'spread_element') {
      const name = element.namedChild(0)
      const mountedAt = `${prefix.api}${prefix.router}`
      if (name?.type === 'identifier' && mountedAt) {
        mounts.push({ path: mountedAt, routerName: name.text, location: locate(element, filePath) })
      }
      continue
    }

    if (element.type !== 'object') continue
    const route = readRoute(element, prefix, filePath)
    if (route) routes.push(route)
  }
}

/**
 * One route object → one registration, or `null` when the object is not a route
 * table entry or its address is not statically known.
 */
function readRoute(object: SyntaxNode, prefix: Prefix, filePath: string): RouteRegistration | null {
  const method = objectStringProperty(object, 'method')?.toUpperCase()
  if (!method || !HTTP_METHODS.has(method)) return null

  const path = objectStringProperty(object, 'path')
  if (path === null || !path.startsWith('/')) return null

  // `handler` is what separates a Strapi route entry from any other object that
  // happens to carry a `method` and a `path`.
  const handler = objectProperty(object, 'handler')
  if (!handler) return null

  const config = objectProperty(object, 'config')
  const ownPrefix = config?.type === 'object' && objectProperty(config, 'prefix') !== null

  return {
    httpMethod: method as RouteRegistration['httpMethod'],
    path: joinPath(prefix.api, ownPrefix ? '' : prefix.router, path),
    handlerName: handler.type === 'string' ? (stringLiteral(handler) ?? '') : '',
    location: locate(object, filePath),
  }
}

function locate(node: SyntaxNode, filePath: string): RouteRegistration['location'] {
  return {
    filePath,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  }
}

function joinPath(api: string, router: string, path: string): string {
  const tail = path === '/' ? '' : path.endsWith('/') ? path.slice(0, -1) : path
  return `${api}${router}${tail}` || '/'
}

function calleeName(call: SyntaxNode): string | null {
  const callee = call.childForFieldName('function')
  if (!callee) return null
  if (callee.type === 'identifier') return callee.text
  if (callee.type === 'member_expression') return callee.childForFieldName('property')?.text ?? null
  return null
}

/** The value node of `{ key: … }`, or `null` when the object has no such key. */
function objectProperty(object: SyntaxNode, key: string): SyntaxNode | null {
  if (object.type !== 'object') return null
  for (let i = 0; i < object.namedChildCount; i++) {
    const pair = object.namedChild(i)
    if (pair?.type !== 'pair') continue
    const name = pair.childForFieldName('key')
    if (!name) continue
    const nameText = name.type === 'string' ? stringLiteral(name) : name.text
    if (nameText === key) return pair.childForFieldName('value')
  }
  return null
}

function objectStringProperty(object: SyntaxNode, key: string): string | null {
  const value = objectProperty(object, key)
  return value ? stringLiteral(value) : null
}

/** Plain quotes, or a backtick string with no interpolation; `null` otherwise. */
function stringLiteral(node: SyntaxNode): string | null {
  if (node.type === 'string') return node.text.replace(/^["'`]|["'`]$/g, '')
  if (node.type === 'template_string') {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i)?.type !== 'string_fragment') return null
    }
    return node.text.replace(/^`|`$/g, '')
  }
  return null
}
