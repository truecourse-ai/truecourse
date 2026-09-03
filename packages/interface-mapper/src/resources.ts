/**
 * RESOURCE FORMATION — the deterministic derivation of a surface's PLACES from
 * the interfaces already derived for it, and of each interface's owning place.
 *
 * The web surface got resources first because "where does this happen" had
 * nowhere else to live there. The envelope was never web-specific:
 * a command tree and a REST path are both "a medium number of medium-sized
 * places, each holding its interactions", and both surfaces were reading as flat
 * lists of 60-odd sibling entries for want of one. This module is all three
 * halves of that, and it is pure: places in, registry + ownership out, no LLM and
 * no filesystem.
 *
 * The cli and api formations take INTERFACES, because on those surfaces the
 * places are a shape over interactions that already exist. The web formation
 * takes the places THEMSELVES (`web-tree.ts` reads them off the tree), because
 * on the web the order is reversed: a screen exists whether or not anyone has
 * written a task that visits it, and web tasks are a later slice. That is also
 * why it establishes no ownership — there is nothing of type `web` to own.
 *
 * It is used TWICE and must stay one implementation: the mappers call it while
 * deriving a catalog, and the reference-catalog migration calls it so a
 * hand-authored catalog's places are formed by exactly the rule a derived one's
 * are.
 *
 * Neither half invents identity: an interface keeps its own fingerprint over
 * `type` + `entry` + `steps`, and the owning place arrives as a REFERENCE on a
 * flat list (`Interface.resource`), never as nesting.
 */

import type { Interface, InterfaceResource, InterfaceResourceId } from '@truecourse/shared'
import type { WebPlace } from './web-tree.js'

/** What a formation pass establishes for one surface. */
export interface ResourceFormation {
  /** The area's registry entries, parents before children (a stable pre-order). */
  resources: InterfaceResource[]
  /** Interface id → the resource that OWNS it. An interface the formation could
   *  not place is simply absent — omitted, never guessed onto a plausible group. */
  owners: Map<string, InterfaceResourceId>
}

/**
 * The web formation, plus the one fact only it can state: which MODULE each
 * place's id was minted from.
 *
 * The id is minted here, from the address; the module arrives on the seed
 * (`WebPlaceSeed.filePath`). Nothing else in the pipeline can rejoin the two
 * afterwards, so the formation hands the pair out rather than dropping it — and
 * it stays OUT of the registry entry, because a file path is not surface-visible
 * shape (`interfaceFingerprint`'s contract) and goes stale the moment a file
 * moves. It is a working-tree fact, re-derived every run, never committed.
 */
export interface WebResourceFormation extends ResourceFormation {
  /** Place id → the seed it was minted from: the module that IS the place, and
   *  the address it is reached at. */
  seeds: Map<InterfaceResourceId, WebPlace>
}

const EMPTY: ResourceFormation = { resources: [], owners: new Map() }

/** `["spec","docs"]` → `spec-docs`; a segment with no alphanumerics contributes nothing. */
function slug(parts: readonly string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Ids are unique within an area's registry; two paths can slugify alike. */
function uniqueId(base: string, used: Set<string>): string {
  const seed = base || 'resource'
  let id = seed
  for (let n = 2; used.has(id); n++) id = `${seed}-${n}`
  used.add(id)
  return id
}

// ---------------------------------------------------------------------------
// CLI — one command-group per command-tree PARENT
// ---------------------------------------------------------------------------

/**
 * The cli places: ONE `command-group` per node of the command tree that other
 * commands are registered UNDER, plus the program's own root group — which is
 * exactly the tree a user reads out of `--help`, and (measured on this repo's own
 * CLI) 13 groups over 62 commands.
 *
 * A command's owner is the group it is REGISTERED IN — its parent path — so
 * `spec docs exclude` belongs to `spec-docs` and `spec docs` itself belongs to
 * `spec`, the way `--help` lists them. A group that is also invocable is
 * therefore listed in its own parent, not in itself: the group is the family a
 * command sits WITH, and a command never sits with its own children.
 *
 * The root group needs the program's NAME, which no analyzer artifact carries —
 * it comes from the recipe/package the caller resolved. Without one there is no
 * honest root, so top-level commands carry no owner at all (the absence rule:
 * nothing established, rather than a group named after a guess); the nested
 * groups still form, because their names come from the command paths themselves.
 */
export function formCliResources(
  interfaces: readonly Interface[],
  opts: { programName?: string } = {},
): ResourceFormation {
  const commands: string[][] = []
  for (const iface of interfaces) {
    const entry = iface.entry as { command?: string[] }
    if (iface.type !== 'cli' || !entry.command || entry.command.length === 0) continue
    commands.push(entry.command)
  }
  if (commands.length === 0) return EMPTY

  const programName = opts.programName?.trim()

  // Every group the tree needs: each command's parent path, and every ancestor of
  // one — a group with no ancestor entry would leave an `of` chain dangling.
  const groupPaths = new Set<string>()
  for (const command of commands) {
    for (let n = command.length - 1; n >= 1; n--) groupPaths.add(command.slice(0, n).join(' '))
  }

  const ordered = [...groupPaths]
    .map((key) => key.split(' '))
    .sort((a, b) => a.length - b.length || a.join(' ').localeCompare(b.join(' ')))

  const used = new Set<string>()
  const idByPath = new Map<string, InterfaceResourceId>()
  const resources: InterfaceResource[] = []

  const rootId = programName ? uniqueId(slug([programName]), used) : undefined
  if (rootId && programName) {
    resources.push({ id: rootId, kind: 'command-group', title: programName })
  }

  for (const path of ordered) {
    const id = uniqueId(slug(path), used)
    idByPath.set(path.join(' '), id)
    const parent = path.length > 1 ? idByPath.get(path.slice(0, -1).join(' ')) : rootId
    resources.push({
      id,
      kind: 'command-group',
      title: programName ? `${programName} ${path.join(' ')}` : path.join(' '),
      ...(parent ? { of: parent } : {}),
    })
  }

  const owners = new Map<string, InterfaceResourceId>()
  for (const iface of interfaces) {
    const entry = iface.entry as { command?: string[] }
    if (iface.type !== 'cli' || !entry.command || entry.command.length === 0) continue
    const parent = entry.command.slice(0, -1)
    const owner = parent.length === 0 ? rootId : idByPath.get(parent.join(' '))
    if (owner) owners.set(iface.id, owner)
  }

  return { resources, owners }
}

// ---------------------------------------------------------------------------
// WEB — one screen per ADDRESS the app serves
// ---------------------------------------------------------------------------

/**
 * The web places: ONE `screen` per address the tree declares, carrying that
 * address so a navigate step can reach it.
 *
 * Flat, and not for want of a hierarchy: a screen sits on nothing — the schema
 * refuses `of` on one, because a screen is the thing dialogs and panels are `of`.
 * The path tree LOOKS like nesting (`/documents` above `/documents/{id}`) but it
 * is not the same relation: `/documents/{id}` is not rendered inside
 * `/documents`, it REPLACES it. The api noun tree nests because a REST path
 * genuinely names a thing within a thing; two addresses of a web app are two
 * places, and saying otherwise would put a false `of` chain in front of every
 * location check.
 *
 * No ownership is established (see the module note): web tasks are a later
 * slice, so there is nothing to own yet, and `owners` comes back empty rather
 * than guessed.
 */
export function formWebResources(places: readonly WebPlace[]): WebResourceFormation {
  if (places.length === 0) return { resources: [], owners: new Map(), seeds: new Map() }

  const used = new Set<string>()
  const resources: InterfaceResource[] = []
  const seeds = new Map<InterfaceResourceId, WebPlace>()
  for (const place of places) {
    // The root address slugifies to nothing, and `/` is a real screen — the one
    // every app has. It is named for what it is rather than left to the generic
    // fallback id.
    const segments = place.address.split('/').filter(Boolean)
    const id = uniqueId(segments.length === 0 ? 'root' : slug(segments), used)
    resources.push({ id, kind: place.kind, title: place.address, address: place.address })
    seeds.set(id, place)
  }

  return { resources, owners: new Map(), seeds }
}

// ---------------------------------------------------------------------------
// API — one rest-noun per NOUN of the path tree, RPC tails excluded
// ---------------------------------------------------------------------------

interface PathNode {
  /** The segment as written — `repos`, or `{id}` for a parameter. */
  segment: string
  param: boolean
  /** Full path template from the root down to and including this node. */
  template: string
  /** Static segments from the root down to here — the id material. */
  staticChain: string[]
  /** Does a static segment sit above this node at all? */
  staticAncestor: boolean
  methods: Set<string>
  children: Map<string, PathNode>
  noun: boolean
}

/**
 * The api places: ONE `rest-noun` per THING the path tree names, with the RPC
 * tails left out of the noun set.
 *
 * **The verb/noun rule.** Taking the last static segment of a path as its noun —
 * the obvious rule, and the one the SOM experiment prototyped — mints `/cancel`,
 * `/dismiss`, `/scan` and `/refresh` as resources: it turns every RPC-shaped
 * endpoint into a place, and on this repo's own 137 operations it produced 87
 * of them. Those segments are not things, they are ACTIONS ON the thing above
 * them, and the tree says so. A static node is a NOUN when any of:
 *
 *  1. **It has children** (a parameter or a further segment). A node other paths
 *     hang off is structural — an action is a leaf by nature, and a noun could
 *     never be registered UNDER a verb.
 *  2. **A GET is rooted exactly at it.** GET is the read of a representation, so
 *     something is there to represent: `/analyses/diff` and `/violations/summary`
 *     are sub-resources, while `/analyses/cancel` (POST alone) is a command
 *     issued to `/analyses`.
 *  3. **No static segment sits above it.** A path's first named segment has no
 *     enclosing noun to be an action ON, so it is the noun — including the api
 *     mount point itself, which becomes the root of the tree rather than a
 *     special case in the rule.
 *
 * Otherwise it is an ACTION, and the operations rooted at it belong to the
 * nearest noun above.
 *
 * The two knowable edges, both accepted deliberately: (a) a write-only
 * sub-resource (`PUT /settings` with no GET) reads as an action on its parent —
 * honest, since nothing in the surface distinguishes it from an RPC tail; (b) a
 * verb that happens to take a parameter (`/jobs/retry/{id}`) reads as a noun, and
 * again the surface itself is what says so. Neither is guessed at: the rule uses
 * only what the route table states.
 *
 * An operation's owner is the DEEPEST noun on its path — parameters bind to the
 * noun above them (an instance of a thing is that thing), actions to the noun
 * they are issued to.
 */
export function formApiResources(interfaces: readonly Interface[]): ResourceFormation {
  const operations: { id: string; method: string; segments: string[] }[] = []
  for (const iface of interfaces) {
    const entry = iface.entry as { method?: string; path?: string }
    if (iface.type !== 'api' || !entry.method || !entry.path) continue
    operations.push({
      id: iface.id,
      method: entry.method.toUpperCase(),
      segments: entry.path.split('/').filter(Boolean),
    })
  }
  if (operations.length === 0) return EMPTY

  const root: PathNode = {
    segment: '',
    param: false,
    template: '',
    staticChain: [],
    staticAncestor: false,
    methods: new Set(),
    children: new Map(),
    noun: false,
  }

  const isParam = (segment: string) => segment.startsWith('{')

  for (const op of operations) {
    let node = root
    for (const segment of op.segments) {
      // Parameters at one position are ONE node whatever they are named: a route
      // table that spells the same slot `{id}` and `{repoId}` describes one place.
      const key = isParam(segment) ? '{}' : segment
      let child = node.children.get(key)
      if (!child) {
        child = {
          segment,
          param: isParam(segment),
          template: `${node.template}/${segment}`,
          staticChain: isParam(segment) ? node.staticChain : [...node.staticChain, segment],
          staticAncestor: node.staticChain.length > 0,
          methods: new Set(),
          children: new Map(),
          noun: false,
        }
        node.children.set(key, child)
      }
      node = child
    }
    node.methods.add(op.method)
  }

  // Classify top-down: rule 1 makes every static ANCESTOR a noun already, so
  // "a noun sits above me" and "a static segment sits above me" are the same
  // question, and one pass settles it.
  const walk = (node: PathNode, visit: (node: PathNode) => void): void => {
    visit(node)
    for (const child of sortedChildren(node)) walk(child, visit)
  }
  walk(root, (node) => {
    if (node === root || node.param) return
    node.noun = node.children.size > 0 || node.methods.has('GET') || !node.staticAncestor
  })

  const used = new Set<string>()
  const idByNode = new Map<PathNode, InterfaceResourceId>()
  const resources: InterfaceResource[] = []
  const nearestNoun = new Map<PathNode, PathNode | undefined>([[root, undefined]])

  walk(root, (node) => {
    if (node === root) return
    const parentNoun = nearestNoun.get(parentOf(node, root))
    nearestNoun.set(node, node.noun ? node : parentNoun)
    if (!node.noun) return
    const id = uniqueId(slug(node.staticChain), used)
    idByNode.set(node, id)
    resources.push({
      id,
      kind: 'rest-noun',
      title: node.template,
      ...(parentNoun ? { of: idByNode.get(parentNoun)! } : {}),
    })
  })

  const owners = new Map<string, InterfaceResourceId>()
  for (const op of operations) {
    let node: PathNode | undefined = root
    for (const segment of op.segments) {
      node = node?.children.get(isParam(segment) ? '{}' : segment)
      if (!node) break
    }
    const owner = node ? nearestNoun.get(node) : undefined
    const id = owner ? idByNode.get(owner) : undefined
    if (id) owners.set(op.id, id)
  }

  return { resources, owners }
}

/** Children in a stable order: named segments alphabetically, the parameter last. */
function sortedChildren(node: PathNode): PathNode[] {
  return [...node.children.values()].sort(
    (a, b) => Number(a.param) - Number(b.param) || a.segment.localeCompare(b.segment),
  )
}

/** The parent of a node, by walking down from the root along its own template. */
function parentOf(node: PathNode, root: PathNode): PathNode {
  const segments = node.template.split('/').filter(Boolean)
  let current = root
  for (const segment of segments.slice(0, -1)) {
    current = current.children.get(segment.startsWith('{') ? '{}' : segment)!
  }
  return current
}
