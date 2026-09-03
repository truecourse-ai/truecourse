/**
 * STATE RECONCILIATION — the pass that keeps the state registry a VOCABULARY
 * rather than a pile of near-synonyms.
 *
 * A state is what tasks CHAIN BY: an earlier task's `endState` and a later
 * task's `startingState` are the same world, or the chain is a coincidence of
 * spelling. Authoring runs one session per screen and a session cannot see the
 * peers running beside it (see `author.ts`), so the same world is minted under
 * two ids by two screens that never met — a whole-app run over documenso landed
 * 289 states across 310 interfaces with 41 `-updated`, 20 `-created` and 17
 * `-exists` families. Nothing is WRONG in that file; it just says one thing many
 * ways, and a registry that does is not a vocabulary.
 *
 * The collapse is safe for one reason worth stating plainly: a state id is a
 * pure REFERENCE. It lives in `states.web[]` and in `startingState`/`endState`,
 * it is never fingerprinted ({@link interfaceFingerprint} covers `type` + `entry`
 * + `steps` only), and flows name states in prose rather than by id. So renaming
 * one moves no fingerprint, invalidates no scenario, and rewrites nothing a
 * human authored except the id itself.
 *
 * Two passes, in this order:
 *
 *  1. DETERMINISTIC — ids whose descriptions say the same thing verbatim (up to
 *     whitespace, case and a trailing period) are one world by construction. No
 *     model needed, and it holds the invariant on its own when the second pass
 *     is skipped or fails.
 *  2. ONE MODEL CALL over the whole surviving list — the only judgement here is
 *     "do these two sentences describe the same world", which needs every id in
 *     front of it at once (a per-family call would re-ask the same question 41
 *     times and could still disagree with itself between families).
 *
 * The model's answer is never trusted structurally: a group whose `keep` does
 * not exist, whose `absorb` names an unknown id, that absorbs its own keeper, or
 * that overlaps a group already accepted is DROPPED ON ITS OWN and reported —
 * one bad group never costs the run its good ones. And the rewrite is held to
 * the catalog's own schema before it is returned: `InterfacesFileSchema` over
 * the MERGED catalog, which is what makes a dangling `startingState` a rejection
 * of the whole reconciliation rather than a corrupted committed file.
 *
 * There is deliberately NO alias table. Idempotence comes from re-running: the
 * pass runs at the end of every authoring run, so a state a later session mints
 * under a synonym is collapsed the next time round, and a reconciled registry
 * re-reconciles to itself.
 *
 * Driver-agnostic, like the rest of this package: the one model call arrives as
 * a {@link ReconcileComplete} callback, and `@truecourse/core` decides which
 * transport answers it.
 */

import { z } from 'zod'
import {
  InterfacesFileSchema,
  type Interface,
  type InterfaceState,
  type InterfacesFile,
} from '@truecourse/shared'
import { jsonSchemaHint, OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm'
import {
  mergeInterfaceCatalogs,
  readAuthoredInterfaceCatalog,
  readInterfaceCatalog,
} from '@truecourse/guard-runner'
import { AUTHORED_SURFACE } from './draft.js'
import { writeAuthoredCatalog } from './write.js'

/** The pipeline stage this pass bills under — one call, whatever the app size. */
export const STATE_RECONCILE_STAGE = 'guard.stateReconcile'

/**
 * One collapse: the id that survives, the ids that fold into it, and (optionally)
 * a description for the survivor that covers the family better than its own did.
 */
export const StateMergeSchema = z
  .object({
    /** The id that stays in the registry. */
    keep: z.string().min(1),
    /** The ids that name the same world and are rewritten to `keep`. */
    absorb: z.array(z.string().min(1)).min(1),
    /** A better one-line description for `keep`; its own is kept when absent. */
    description: z.string().min(1).optional(),
  })
  .strict()
export type StateMerge = z.infer<typeof StateMergeSchema>

export const StateReconcileResponseSchema = z
  .object({ groups: z.array(StateMergeSchema) })
  .strict()

/** The response contract, rendered once from the Zod source the reply is parsed with. */
export const STATE_RECONCILE_RESPONSE_SCHEMA = jsonSchemaHint(StateReconcileResponseSchema)

/**
 * The one-shot model call this pass needs: a prompt and the JSON schema its
 * answer must satisfy in, the PARSED JSON value out. The caller owns the
 * transport, the model and the parse — this package owns the question.
 */
export type ReconcileComplete = (
  prompt: { system: string; user: string },
  schema: string,
) => Promise<unknown>

export interface ReconcileStatesInput {
  /** The derived snapshot — read-only here; the derivation mints no states. */
  derived: InterfacesFile | null
  /** The authored half, the only file that carries states and the one rewritten. */
  authored: InterfacesFile | null
  /** Absent = the deterministic pass alone (no model call, no spend). */
  complete?: ReconcileComplete
}

export interface StateReconciliation {
  /**
   * `unchanged` = nothing collapsed (the registry already says each world once,
   * or the model proposed nothing usable); `reconciled` = a rewritten catalog;
   * `rejected` = a rewrite was produced and the merged catalog refused it, so
   * the original stands untouched.
   */
  status: 'unchanged' | 'reconciled' | 'rejected'
  /** States in the registry before and after — the `states N→M` of the footer. */
  before: number
  after: number
  /** Ids absorbed, i.e. `before - after`. */
  merged: number
  /** The collapses that were applied, deterministic ones first. */
  merges: StateMerge[]
  /** Groups the model proposed that broke a guardrail, one line each. */
  dropped: string[]
  /** Why nothing landed, or what went wrong while it did — never a stack. */
  problems: string[]
  /** The rewritten authored half; present only when `status === 'reconciled'`. */
  authored?: InterfacesFile
  /** Where it was written, when {@link reconcileAuthoredStates} wrote it. */
  path?: string
}

/**
 * Reconcile the state registry of an authored catalog and hand back the file it
 * would become. Pure: it reads nothing and writes nothing.
 */
export async function reconcileStates(input: ReconcileStatesInput): Promise<StateReconciliation> {
  const registry = input.authored?.states?.[AUTHORED_SURFACE] ?? []
  const empty: StateReconciliation = {
    status: 'unchanged',
    before: registry.length,
    after: registry.length,
    merged: 0,
    merges: [],
    dropped: [],
    problems: [],
  }
  if (!input.authored || registry.length === 0) return empty

  const merges = collapseIdenticalDescriptions(registry)
  const dropped: string[] = []
  const problems: string[] = []

  if (input.complete) {
    const gone = absorbed(merges)
    const survivors = registry.filter((state) => !gone.has(state.id))
    try {
      const raw = await input.complete(reconcilePrompt(survivors), STATE_RECONCILE_RESPONSE_SCHEMA)
      const parsed = StateReconcileResponseSchema.safeParse(raw)
      if (!parsed.success) {
        problems.push(`the reconciliation reply did not match its schema: ${describe(parsed.error)}`)
      } else {
        const accepted = acceptGroups(parsed.data.groups, new Set(survivors.map((s) => s.id)))
        merges.push(...accepted.merges)
        dropped.push(...accepted.dropped)
      }
    } catch (error) {
      // A pass that could not ask still keeps whatever the deterministic half
      // found: this is a tidying step, and losing it costs a re-run, not a run.
      problems.push(`the reconciliation call failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (merges.length === 0) return { ...empty, dropped, problems }

  const resolve = resolver(merges)
  const states = rewriteRegistry(registry, merges)
  const candidate: InterfacesFile = {
    ...input.authored,
    interfaces: rewriteInterfaces(input.authored.interfaces, resolve),
    states: { ...input.authored.states, [AUTHORED_SURFACE]: states },
  }

  // The rewrite touched every reference in the file; the catalog's own schema is
  // what proves it left none dangling. It runs over the MERGE because that is
  // the catalog consumers read and where an id resolves or does not.
  const parsed = InterfacesFileSchema.safeParse(mergeInterfaceCatalogs(input.derived, candidate))
  if (!parsed.success) {
    return {
      status: 'rejected',
      before: registry.length,
      after: registry.length,
      merged: 0,
      merges,
      dropped,
      problems: [
        ...problems,
        ...parsed.error.issues.map((issue) => `${issue.path.join('.') || 'catalog'} — ${issue.message}`),
      ],
    }
  }

  return {
    status: 'reconciled',
    before: registry.length,
    after: states.length,
    merged: registry.length - states.length,
    merges,
    dropped,
    problems,
    authored: candidate,
  }
}

export interface ReconcileAuthoredInput {
  repoRoot: string
  /** Absent = the deterministic pass alone. */
  complete?: ReconcileComplete
  now?: () => string
}

/**
 * The store-side wrapper: read both halves, reconcile, and write the authored
 * one through the same path authoring writes through — so the file is validated
 * and replaced atomically here exactly as it is after a session.
 */
export async function reconcileAuthoredStates(
  input: ReconcileAuthoredInput,
): Promise<StateReconciliation> {
  const derived = readInterfaceCatalog(input.repoRoot)
  const authored = readAuthoredInterfaceCatalog(input.repoRoot)
  const result = await reconcileStates({
    derived,
    authored,
    ...(input.complete ? { complete: input.complete } : {}),
  })
  if (result.status !== 'reconciled' || !result.authored) return result
  const written = writeAuthoredCatalog({
    repoRoot: input.repoRoot,
    candidate: result.authored,
    derived,
    ...(input.now ? { now: input.now } : {}),
  })
  return { ...result, authored: written.file, path: written.path }
}

// ---------------------------------------------------------------------------
// the deterministic pass
// ---------------------------------------------------------------------------

/**
 * Ids whose descriptions are the same sentence. Whitespace, case and a trailing
 * period are formatting, not meaning, so they are normalized away; anything
 * beyond that is a judgement and belongs to the model pass. The FIRST id in
 * registry order keeps, which makes the pass stable across runs.
 */
function collapseIdenticalDescriptions(registry: readonly InterfaceState[]): StateMerge[] {
  const byDescription = new Map<string, string[]>()
  for (const state of registry) {
    const key = normalize(state.description)
    byDescription.set(key, [...(byDescription.get(key) ?? []), state.id])
  }
  const merges: StateMerge[] = []
  for (const ids of byDescription.values()) {
    if (ids.length < 2) continue
    merges.push({ keep: ids[0]!, absorb: ids.slice(1) })
  }
  return merges
}

function normalize(description: string): string {
  return description.trim().replace(/\s+/g, ' ').replace(/\.$/, '').toLowerCase()
}

// ---------------------------------------------------------------------------
// the model pass
// ---------------------------------------------------------------------------

const RECONCILE_SYSTEM_PROMPT = `You reconcile a STATE REGISTRY: the vocabulary of worlds an application's UI tasks assume and leave.

${OUTPUT_ONLY_GUARDRAIL}

Each entry is an id and one line saying what world that id names. The registry was written a screen at a time by authors who could not see each other's work, so THE SAME WORLD is often named twice under different ids ("document-created" / "document-exists" / "new-document-saved"). Your job is to say which ids name the same world, so each world is named once.

Group ids that a test could NOT tell apart: if a task can start from either one, or end in either one, and no assertion could distinguish them, they are one world. Group nothing else.

Two worlds are DIFFERENT — never group them — when:
- one is a superset or a later stage of the other ("a document exists" vs "a document is signed by every recipient");
- they differ in WHO the world is true for ("the admin is signed in" vs "a member is signed in");
- they differ in count or quantity ("at least one team exists" vs "the team list is empty");
- one names a transient outcome and the other a durable fact ("a save just succeeded" vs "the saved settings are in effect").

A state is a WORLD, never a place: "the settings dialog is open" is a location, not a state, and is not grouped with "the settings are saved".

For each group, answer with:
- "keep": the id that stays — the clearest, most general name in the group, and it MUST be one of the ids listed below;
- "absorb": the other ids of the group, each of which will be rewritten to "keep" everywhere it is referenced;
- "description": OPTIONAL — a single line describing the world, when the kept id's own line describes the family less well than the ones it absorbs.

Rules that make an answer usable: every id you name must appear in the list; an id may appear in at most ONE group, once, in one role; "keep" is never also in its own "absorb". Ids you do not group are left alone — omitting them is the correct answer for a world that is already named once. If nothing should be grouped, answer with an empty "groups" array.`

/** The prompt for the one call: the whole registry, ids and their one-liners. */
export function reconcilePrompt(states: readonly InterfaceState[]): {
  system: string
  user: string
} {
  return {
    system: RECONCILE_SYSTEM_PROMPT,
    user: [
      `The registry has ${states.length} state(s):`,
      '',
      ...states.map((state) => `${state.id}: ${state.description}`),
      '',
      'Answer with the groups of ids that name the same world.',
    ].join('\n'),
  }
}

/**
 * The guardrails, applied group by group. Every rejection names the group and
 * the reason: a dropped group is a REPORT, not a silent correction, because the
 * same model producing the same bad shape every run is a prompt problem someone
 * has to be able to see.
 */
function acceptGroups(
  groups: readonly StateMerge[],
  known: ReadonlySet<string>,
): { merges: StateMerge[]; dropped: string[] } {
  const merges: StateMerge[] = []
  const dropped: string[] = []
  const claimed = new Set<string>()

  for (const group of groups) {
    const absorb = [...new Set(group.absorb)]
    const label = `${group.keep} ← ${absorb.join(', ') || '(nothing)'}`
    const unknown = [group.keep, ...absorb].filter((id) => !known.has(id))
    if (unknown.length > 0) {
      dropped.push(`${label}: no such state — ${unknown.join(', ')}`)
      continue
    }
    if (absorb.length === 0) {
      dropped.push(`${label}: the group absorbs nothing`)
      continue
    }
    if (absorb.includes(group.keep)) {
      dropped.push(`${label}: \`${group.keep}\` absorbs itself`)
      continue
    }
    const overlap = [group.keep, ...absorb].filter((id) => claimed.has(id))
    if (overlap.length > 0) {
      dropped.push(`${label}: already grouped — ${overlap.join(', ')}`)
      continue
    }
    for (const id of [group.keep, ...absorb]) claimed.add(id)
    merges.push({
      keep: group.keep,
      absorb,
      ...(group.description ? { description: group.description } : {}),
    })
  }
  return { merges, dropped }
}

// ---------------------------------------------------------------------------
// the rewrite
// ---------------------------------------------------------------------------

function absorbed(merges: readonly StateMerge[]): Set<string> {
  const gone = new Set<string>()
  for (const merge of merges) for (const id of merge.absorb) gone.add(id)
  return gone
}

/**
 * id → the id it becomes. Merges compose (the deterministic pass keeps an id the
 * model pass may then absorb), so the chain is followed, with a visited guard:
 * the guardrails cannot produce a cycle, and a rewrite that looped would hang
 * rather than fail.
 */
function resolver(merges: readonly StateMerge[]): (id: string) => string {
  const to = new Map<string, string>()
  for (const merge of merges) for (const id of merge.absorb) to.set(id, merge.keep)
  return (id: string): string => {
    const seen = new Set<string>([id])
    let current = id
    for (;;) {
      const next = to.get(current)
      if (!next || seen.has(next)) return current
      seen.add(next)
      current = next
    }
  }
}

/** The registry minus the absorbed ids, with any re-description applied. */
function rewriteRegistry(
  registry: readonly InterfaceState[],
  merges: readonly StateMerge[],
): InterfaceState[] {
  const gone = absorbed(merges)
  const described = new Map<string, string>()
  for (const merge of merges) {
    if (merge.description) described.set(merge.keep, merge.description)
  }
  return registry
    .filter((state) => !gone.has(state.id))
    .map((state) => {
      const description = described.get(state.id)
      return description ? { ...state, description } : state
    })
}

/**
 * Every reference, rewritten. Only the authored surface's tasks are touched:
 * state ids resolve in their own AREA's registry, so a `cli` entry naming
 * `document-exists` means the cli registry's world and this pass never saw it.
 */
function rewriteInterfaces(
  interfaces: readonly Interface[],
  resolve: (id: string) => string,
): Interface[] {
  return interfaces.map((iface) => {
    if (iface.type !== AUTHORED_SURFACE) return iface
    const startingState = iface.startingState ? resolve(iface.startingState) : undefined
    const endState = iface.endState ? resolve(iface.endState) : undefined
    if (startingState === iface.startingState && endState === iface.endState) return iface
    return {
      ...iface,
      ...(startingState ? { startingState } : {}),
      ...(endState ? { endState } : {}),
    }
  })
}

function describe(error: z.ZodError): string {
  const issue = error.issues[0]
  return issue ? `${issue.path.join('.') || 'root'} — ${issue.message}` : 'schema validation failed'
}
