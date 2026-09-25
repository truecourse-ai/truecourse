/**
 * THE SESSION'S TOOLS — every one of them READ-ONLY, and every one of them
 * bounded. An authoring session reads the app's own source (the JSX that
 * declares a screen's controls), reads the catalog it is extending, and checks
 * its own draft; it writes nothing. The write happens when accepting an outcome,
 * in {@link ../write.ts} — a tool that wrote would put half a fragment on disk
 * every time a session ran out of budget mid-draft.
 *
 * THE PLACES ARE NOT A TOOL. They were — `list_places` — and a tool
 * result is the most expensive way to state a fact that never changes: every
 * session called it once, and the whole table then rode every subsequent turn
 * of that session's history, 245KB of re-sent tool results per run. The same
 * table in the BRIEFING sits in the cached prefix instead, and the session has
 * it before it asks. What a session needs of it is small and stated there: the
 * screens with their addresses (what `to` names), and the dialogs and panels on
 * its own place (what `of` names).
 *
 * `observe_screen` is the one tool that is not about the source: it opens an
 * address of the RUNNING app in a signed-in browser and returns its
 * accessibility tree (see `live-screen.ts`). It exists only when the run
 * booted the app; a session without it authors from source alone.
 *
 * `check_draft` is the one that makes the LOOP earn its keep rather than a
 * single prompt: the rules of {@link validateFragment} are dozens of small
 * structural facts (an id that resolves, a role that exists, an entry that
 * agrees with its place), and a model that can ASK is a model that converges on
 * them instead of being re-prompted about them. It is the same function the
 * write path runs. A peer can change the catalog after a check, so outcome
 * acceptance validates again and returns any new conflicts for correction.
 *
 * What it is asked for is an EARLY call and a SMALL one: the fragment is
 * dropped whole when it breaks a rule, so a session that first checks at turn
 * 24 pays for a misreading with the whole place, while the same misreading on a
 * first task at turn 5 costs a turn. A call carries the piece it is about,
 * and what passes is kept for the session — see {@link checkDraftTool}.
 */

import { z } from 'zod'
import { defineSessionTool, type SessionTool } from '@truecourse/agent-loop'
import {
  ANONYMOUS_PRINCIPAL,
  interfaceStepLocator,
  isNonCanonicalLocator,
  isTargetedStep,
  readableLocators,
  type InterfaceReadableKind,
  type InterfaceResource,
  type InterfacesFile,
} from '@truecourse/shared'
import { readFileTool, readFilesTool, searchTool } from '../agent/repo-tools.js'
import { liveAuthorCatalog } from './catalog-context.js'
import {
  AuthoredFragmentSchema,
  AuthoredTaskSchema,
  EMPTY_FRAGMENT,
  collapseAuthoredIds,
  foldAuthoredFragment,
  validateFragment,
  type AuthoredFragment,
  type AuthoredTask,
} from './draft.js'
import { checkedDraftEvidence } from './checked-draft.js'
import { scopeFragmentIds } from './identity.js'
import { observeScreenTool, principalNames, type LiveScreens } from './live-screen.js'
import { LiveProofReachSchema, proveLocators, proveReadables, type LiveProofReach } from './live-proof.js'
import { principalsReaching, webSessionCredentials } from './principals.js'
import { loadRecipe, recipePath } from '@truecourse/guard-runner'

/** How many catalog entries one `list_interfaces` call hands back — a tool
 *  result is context, and context is the budget. */
const MAX_INTERFACES_LISTED = 200

export interface AuthorToolsInput {
  repoRoot: string
  /** The derived snapshot — the places, and the api ids `apiEffects` names. */
  derived: InterfacesFile | null
  /** The authored file as it stands on disk. */
  authored: InterfacesFile | null
  /** Ids this session may replace (its work item's own prior tasks). */
  replaceable: ReadonlySet<string>
  /** The place this session authors — `check_draft` holds the draft to it. */
  scope?: { screenId: string; address?: string }
  /** Other places' tasks this session's draft may twin (see {@link validateFragment}'s `yielding`). */
  yielding?: ReadonlySet<string>
  /** The running app, when the run booted one — adds `observe_screen`. */
  live?: LiveScreens
}

export function buildAuthorTools(input: AuthorToolsInput): SessionTool[] {
  return [
    readFileTool(input.repoRoot),
    readFilesTool(input.repoRoot),
    searchTool(input.repoRoot),
    ...(input.live ? [observeScreenTool(input.live)] : []),
    interfacesTool(input),
    ...catalogTools(input),
    checkDraftTool(input),
  ]
}

function catalogTools(input: AuthorToolsInput): SessionTool[] {
  const catalog = liveAuthorCatalog(input)
  return [
    defineSessionTool({
      name: 'search_interfaces', kind: 'read-interface-catalog',
      description: 'Search current web catalog metadata, including tasks owned by or navigating to a resource. Page with nextCursor. Fetch exact steps with get_interfaces. Unrelated catalog changes do not invalidate pages; restart only if the requested results change.',
      readOnly: true, destructive: false,
      inputSchema: z.object({ query: z.string().max(500), purpose: z.enum(['task', 'control']).optional(), resource: z.string().min(1).max(200).optional(), limit: z.number().int().min(1).max(20).optional(), cursor: z.string().max(1000).optional() }).strict(),
      async execute(args) { return catalog().search(args) },
    }),
    defineSessionTool({
      name: 'get_interfaces', kind: 'read-interface-catalog',
      description: 'Read 1–5 exact web action definitions as compact objects. Resources/readables are optional: includeResources:true. Items carry ID, path and value; oversized objects use exact field continuations. Keep IDs and projection unchanged when paging with nextCursor. Never treat incomplete definitions as complete.',
      readOnly: true, destructive: false,
      inputSchema: z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(5), cursor: z.string().max(1000).optional(), includeResources: z.boolean().optional() }).strict(),
      async execute(args) { return catalog().get({ ...args, includeResources: args.includeResources ?? false }) },
    }),
    ...(['resources', 'states'] as const).map(kind => defineSessionTool({
      name: `get_${kind}`, kind: 'read-interface-catalog',
      description: `Read 1–5 exact catalog ${kind} by ID. Use this for registry definitions, never source search on hidden catalog files. Continue incomplete results with the same IDs and nextCursor.`,
      readOnly: true, destructive: false,
      inputSchema: z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(5), cursor: z.string().max(1000).optional() }).strict(),
      async execute(args) { return kind === 'resources' ? catalog().getResources(args) : catalog().getStates(args) },
    })),
  ]
}

// ---------------------------------------------------------------------------
// the catalog the draft extends
// ---------------------------------------------------------------------------

function interfacesTool(input: AuthorToolsInput): SessionTool {
  return defineSessionTool({
    name: 'list_interfaces',
    description:
      'List the interfaces already in the catalog. Use `surface: "api"` to find the ids `apiEffects` names, and `surface: "web"` to see which tasks are already authored (never author one twice).',
    kind: 'list-interfaces',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        surface: z.enum(['web', 'api', 'cli']).describe('Which surface to list.'),
        contains: z.string().min(1).optional().describe('Keep only entries whose id or title contains this text.'),
      })
      .strict(),
    async execute(args) {
      const all = [
        ...(input.derived?.interfaces ?? []).map((i) => ({ i, origin: 'derived' })),
        ...(input.authored?.interfaces ?? []).map((i) => ({ i, origin: 'authored' })),
      ].filter(({ i }) => i.type === args.surface)
      if (all.length === 0) return { content: `The catalog has no \`${args.surface}\` interface at all.` }
      const needle = args.contains?.toLowerCase()
      const filtered = needle
        ? all.filter(({ i }) => i.id.toLowerCase().includes(needle) || i.title.toLowerCase().includes(needle))
        : all
      // A filter that matches NOTHING answers the wrong question. The pilot's
      // worst turn-waster was six `contains` probes guessing names against a
      // surface that spells its operations differently — so a miss hands back the
      // surface itself when it fits, which settles the question in one call.
      const missed = needle !== undefined && filtered.length === 0
      const matched = missed && all.length <= MAX_INTERFACES_LISTED ? all : filtered
      if (matched.length === 0) {
        return {
          content: `No \`${args.surface}\` interface matches \`${args.contains}\`. The surface has ${all.length} entries — list them without \`contains\`, or search the source for what this screen actually calls.`,
        }
      }
      const shown = matched.slice(0, MAX_INTERFACES_LISTED)
      const rows = shown.map(({ i, origin }) => {
        const entry = 'command' in i.entry ? i.entry.command.join(' ') : `${i.entry.method} ${i.entry.path}`
        return `${i.id}  ·  ${entry}  ·  ${origin}  ·  ${i.title}`
      })
      const head = missed
        ? `Nothing matches \`${args.contains}\`. The whole \`${args.surface}\` surface is ${all.length} entries, so here it is:\n`
        : ''
      const tail = matched.length > shown.length ? `\n… ${matched.length - shown.length} more — narrow with \`contains\`.` : ''
      return { content: head + rows.join('\n') + tail + (args.surface === 'web' ? '\nUse search_interfaces for paged web lookup and get_interfaces for exact steps.' : '') }
    },
  })
}

/**
 * THE ACCEPTED DRAFT IS SESSION STATE. A tool instance belongs to one session,
 * so the draft it is building can live in this closure — and that is what turns
 * `check_draft` from a whole-catalog submission into an incremental one: a call
 * carries the piece it is about, the piece is checked against the catalogs AND
 * against everything this session has already had accepted, and what passes is
 * kept. Fixing one locator then costs one interface instead of forty-five.
 *
 * Uniqueness is why the accepted draft has to be the thing checked: an id and a
 * fingerprint name one thing across the whole draft, not within one call.
 *
 * A task whose locator is non-canonical (`css`) or declares a `pick` is also
 * PROVEN on the running app before it is kept ({@link proveLocators}); a `proof`
 * entry fills a slotted entry and, for a task that cannot be replayed, lists the
 * actions that reach its controls. It is kept for the session like the draft is.
 *
 * `outcome` resolves the draft by the id of the check that accepted it, exactly
 * as it always has — the artifact carries the accumulated fragment, so nothing
 * about resolution (or about a resume, which reads the artifact off the
 * transcript) changes with the call that produced it.
 */
function checkDraftTool(input: AuthorToolsInput): SessionTool {
  let accepted: AuthoredFragment = EMPTY_FRAGMENT
  let reach: LiveProofReach = {}
  // Which principals reach an address, asked once per address a proof was sent away from.
  const reachingByPath = new Map<string, Promise<string[]>>()
  const reaching = (path: string): Promise<string[]> => {
    if (!input.live) return Promise.resolve([])
    const known = reachingByPath.get(path) ?? principalsReaching(input.live, path)
    reachingByPath.set(path, known)
    return known
  }
  return defineSessionTool({
    name: 'check_draft',
    description:
      'Check ONE interface, a few, or the whole draft against every rule the write path enforces — id uniqueness, fingerprint uniqueness, the target policy, reachability, all four readable kinds stated on every place you declare, and the catalog schema. A step whose locator uses `css` or `pick` is also PROVEN on the running app: its address is opened, the task\'s clicks before it are replayed (only when every earlier step is a click and the task has no endState), and it must resolve to exactly one visible element (a `pick` position within the matches). When the task cannot be replayed, pass `proof: {"<task id>": {"steps": [{"activate": <locator>} | {"fill": <locator>, "value": "<text>"} | {"select": <locator>, "option": "<label>"}, …]}}` — never a control that submits, deletes, cancels or signs out; when the entry has a {slot}, add `"path": "<the entry with every slot filled>"`. A readable whose locator uses `css` is proven the same way at this place\'s address, after the actions a `proof` entry keyed by the place\'s id lists (the way into a dialog). What passes is KEPT for the rest of this session and checked against by every later call, so check as you go: your first task or two, then each piece as you finish it. NEVER resend an interface that was already accepted — send an id again only to CORRECT that entry. Call `outcome` with the draftId of your last accepted check; acceptance checks the current catalog again and returns any new conflicts for correction.',
    kind: 'check-draft',
    readOnly: true,
    destructive: false,
    inputSchema: AuthoredFragmentSchema.extend({ proof: LiveProofReachSchema.optional() }),
    async execute({ proof, ...sent }) {
      const piece = withObservedPrincipal(withoutProvenWords(sent), input.live)
      const unknownPrincipals = unknownPrincipalProblems(piece.interfaces, input)
      if (unknownPrincipals.length > 0) {
        return {
          content: `${unknownPrincipals.length} problem(s) — nothing in this call was accepted, and the draft still holds ${accepted.interfaces.length} task(s):\n- ${unknownPrincipals.join('\n- ')}`,
          isError: true,
        }
      }
      const combined = foldAuthoredFragment(accepted, piece)
      const fragment = collapseAuthoredIds(scopeFragmentIds(combined, input))
      const result = validateFragment({
        derived: input.derived,
        authored: input.authored,
        fragment,
        replaceable: input.replaceable,
        ...(input.scope ? { scope: input.scope } : {}),
        ...(input.yielding ? { yielding: input.yielding } : {}),
      })
      if (!result.ok) {
        return {
          content: `${result.errors.length} problem(s) — nothing in this call was accepted, and the draft still holds ${
            accepted.interfaces.length
          } task(s):\n- ${result.errors.join('\n- ')}`,
          isError: true,
        }
      }
      const proven = { ...reach, ...proof }
      const tasks = await proveLocators(piece.interfaces, input.live, proven, reaching)
      const readables = await proveReadables(piece.resources ?? [], input.live, proven, input.scope?.address, reaching)
      const problems = [...tasks.problems, ...readables.problems]
      if (problems.length > 0) {
        return {
          content: `${problems.length} locator(s) did not hold on the live screen — nothing in this call was accepted, and the draft still holds ${
            accepted.interfaces.length
          } task(s):\n- ${problems.join('\n- ')}`,
          isError: true,
        }
      }
      reach = proven
      // A task or a place whose address no principal reaches had nothing to be
      // proven on: its css, written from source, is kept and stamped unproven.
      accepted = tasks.unproven.size > 0 || readables.unproven.size > 0
        ? collapseAuthoredIds(scopeFragmentIds(foldAuthoredFragment(accepted, stampUnproven(piece, tasks.unproven, readables.unproven)), input))
        : fragment
      const artifact = checkedDraftEvidence(accepted)
      return {
        content: [
          `Accepted and kept. The draft now holds ${accepted.interfaces.length} task(s), ${
            accepted.states?.length ?? 0
          } state(s), ${accepted.resources?.length ?? 0} place(s).`,
          ...draftIds(accepted),
          `Do not send any of them again except to correct one. To finish, call outcome with ${JSON.stringify(
            { draftId: artifact.draftId },
          )} — do not repeat the draft. Final acceptance checks the current catalog again.`,
        ].join('\n'),
        artifact,
      }
    },
  })
}

/**
 * The piece with every task that names no principal recorded as the one the
 * run observes and proves as by default, when that is a seeded principal: the
 * session omits it for the default, and generation signs a scenario in as
 * whoever the catalog names. A run that could sign in as nobody names no one.
 */
function withObservedPrincipal(piece: AuthoredFragment, live: LiveScreens | undefined): AuthoredFragment {
  const own = live?.observer.principal
  if (own === undefined || own === ANONYMOUS_PRINCIPAL) return piece
  // Parsed back so the key sits where the schema puts it: a checked draft's id
  // is a digest of its JSON, and the outcome resolves it from the parsed copy.
  return {
    ...piece,
    interfaces: piece.interfaces.map((task) => (task.principal === undefined ? AuthoredTaskSchema.parse({ ...task, principal: own }) : task)),
  }
}

/** The piece with every `proven` the session wrote dropped: it is the check's word, never the session's. */
function withoutProvenWords(piece: AuthoredFragment): AuthoredFragment {
  return {
    ...piece,
    interfaces: piece.interfaces.map((task) => ({
      ...task,
      steps: task.steps.map((step) => {
        if (step.kind === 'navigate' || step.kind === 'upload' || !('proven' in step)) return step
        const { proven: _sessionWord, ...rest } = step
        return rest
      }),
    })),
    ...(piece.resources ? { resources: piece.resources.map((place) => withReadablesProven(place, false)) } : {}),
  }
}

/** Every `css` step of the tasks `tasks` names, and every `css` readable of the places `places` names, stamped `proven: false`. */
function stampUnproven(piece: AuthoredFragment, tasks: ReadonlySet<string>, places: ReadonlySet<string>): AuthoredFragment {
  return {
    ...piece,
    interfaces: piece.interfaces.map((task) =>
      tasks.has(task.id)
        ? {
            ...task,
            steps: task.steps.map((step) =>
              isTargetedStep(step) && step.kind !== 'upload' && isNonCanonicalLocator(interfaceStepLocator(step)) ? { ...step, proven: false as const } : step,
            ),
          }
        : task,
    ),
    ...(piece.resources
      ? { resources: piece.resources.map((place) => (places.has(place.id) ? withReadablesProven(place, true) : place)) }
      : {}),
  }
}

/**
 * A place with its readables' `proven` words replaced: every `css` fact stamped
 * `false` when `unproven`, and every word dropped otherwise.
 */
function withReadablesProven(place: InterfaceResource, unproven: boolean): InterfaceResource {
  const { readables } = place
  if (!readables) return place
  const css = new Set(
    readableLocators(place)
      .filter((readable) => isNonCanonicalLocator(readable.locator))
      .map((readable) => `${readable.kind}/${readable.index}`),
  )
  const word = (kind: InterfaceReadableKind, index: number) =>
    unproven && css.has(`${kind}/${index}`) ? { proven: false as const } : {}
  return {
    ...place,
    readables: {
      ...readables,
      ...(readables.markers ? { markers: readables.markers.map(({ proven: _, ...fact }, i) => ({ ...fact, ...word('markers', i) })) } : {}),
      ...(readables.elements ? { elements: readables.elements.map(({ proven: _, ...fact }, i) => ({ ...fact, ...word('elements', i) })) } : {}),
      ...(readables.controls ? { controls: readables.controls.map(({ proven: _, ...fact }, i) => ({ ...fact, ...word('controls', i) })) } : {}),
      ...(readables.rows ? { rows: readables.rows.map(({ proven: _, ...fact }, i) => ({ ...fact, ...word('rows', i) })) } : {}),
    },
  }
}

/**
 * A task that names a principal it cannot be performed as: with a live world,
 * one the run cannot observe as; without one, one the recipe's seed declares
 * no web session for (or `anonymous`).
 */
function unknownPrincipalProblems(tasks: readonly AuthoredTask[], input: Pick<AuthorToolsInput, 'repoRoot' | 'live'>): string[] {
  if (tasks.every((task) => task.principal === undefined)) return []
  const names = input.live ? principalNames(input.live) : declaredPrincipalNames(input.repoRoot)
  return tasks.flatMap((task) =>
    task.principal === undefined || names.includes(task.principal)
      ? []
      : [`\`${task.id}\` names principal \`${task.principal}\`, which ${input.live ? 'the run cannot observe as' : 'the seed declares no web session for'} — use one of ${names.map((name) => `\`${name}\``).join(', ')}, or omit it for this session's own`],
  )
}

/** Whom a task may be performed as when no browser is open: the web sessions the recipe's seed declares, and `anonymous`. */
function declaredPrincipalNames(repoRoot: string): string[] {
  const declared = Object.entries(loadRecipe(repoRoot, recipePath(repoRoot))?.recipe.api?.seed?.provides.credentials ?? {})
  return [...webSessionCredentials(declared).map(([name]) => name), ANONYMOUS_PRINCIPAL]
}

/** How many of the accepted task ids the tool result names before it counts the
 *  rest — the list is a reminder of what is already held, not the draft itself. */
const MAX_DRAFT_IDS_LISTED = 30

/** The ids the draft holds, one per line — what "already accepted" names. */
function draftIds(fragment: AuthoredFragment): string[] {
  const ids = fragment.interfaces.map((task) => `  ${task.id}`)
  if (ids.length <= MAX_DRAFT_IDS_LISTED) return ids
  return [...ids.slice(0, MAX_DRAFT_IDS_LISTED), `  … ${ids.length - MAX_DRAFT_IDS_LISTED} more`]
}
