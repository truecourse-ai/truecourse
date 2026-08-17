/**
 * THE DRAFT — what an authoring session is allowed to hand back, and every rule
 * it has to satisfy before a byte reaches `guard/interfaces.authored.json`.
 *
 * The session authors WEB TASKS: the half of the web surface no derivation
 * produces (SPEC_GUARD_PLAN item 103 — a place is stated by the routing tree, a
 * task is intent no tree states). Two things are deliberately NOT the model's to
 * write:
 *
 * - **The fingerprint.** It is `sha256` over `type` + `entry` + `steps`
 *   ({@link interfaceFingerprint}), so it is a FUNCTION of the draft, computed
 *   here. A model-written fingerprint is a fact that can disagree with its own
 *   entry, and every scenario grounded on it would inherit the disagreement.
 * - **`origin`.** Stamped by the merge that joins the two catalog halves, never
 *   declared by a file — the field exists precisely because a declared one lied
 *   for months (see {@link InterfaceOriginSchema}).
 *
 * The CONTRACT is absent for a third reason, and it is the schema's own: the
 * contract union has `cli` and `api` members only, and `contract.surface` must
 * equal the interface's type — a web task cannot carry one at all. What a web
 * place SHOWS is its resource's `readables`, which this pass does not author
 * either (item 103's deliberate deferral: dialogs and panels are a
 * component-graph question, and readables are a vocabulary of their own).
 *
 * Every rule below is checked against the MERGED catalog — the derived snapshot
 * joined with the authored file the draft would land in — because that is the
 * catalog every consumer reads. An id resolves, or a fingerprint collides,
 * against the whole thing or against nothing.
 */

import { z } from 'zod'
import {
  GUARD_WEB_ROLES,
  InterfaceOperationEntrySchema,
  InterfaceResourceIdSchema,
  InterfaceResourceKindSchema,
  InterfaceActivateStepSchema,
  InterfaceInputStepSchema,
  InterfaceNavigateStepSchema,
  InterfaceStateIdSchema,
  InterfaceStateSchema,
  InterfacesFileSchema,
  interfaceFingerprint,
  type Interface,
  type InterfaceResource,
  type InterfaceState,
  type InterfacesFile,
} from '@truecourse/shared'
import { mergeInterfaceCatalogs } from '@truecourse/guard-runner'

/** The surface this pass authors. Web is the only one nothing derives. */
export const AUTHORED_SURFACE = 'web'

/** `web/<kebab-slug>` — the id shape every authored task is held to. */
const AUTHORED_ID = /^web\/[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * `<role> "<accessible name>"` — the locator policy of AGENTIC_PIPELINE_PLAN
 * §10.3 written as a target string: roles and accessible names only, never CSS,
 * never a test id. All 57 step targets of the reference corpus are in this form,
 * so it is the corpus's grammar, not a new one.
 */
const TARGET_GRAMMAR = /^([a-z]+) "([^"]+)"$/

/**
 * The steps a web task is made of — the three web members of the shared step
 * vocabulary. `invoke` and `request` are the cli and api members: a web task
 * that wanted one would be describing another surface's interface, and the
 * closed union says so at parse time rather than in a review comment. It also
 * keeps the outcome schema a driver renders down to what a web task can be,
 * which is the clearest instruction there is.
 */
export const AuthoredWebStepSchema = z.discriminatedUnion('kind', [
  InterfaceNavigateStepSchema,
  InterfaceInputStepSchema,
  InterfaceActivateStepSchema,
])
export type AuthoredWebStep = z.infer<typeof AuthoredWebStepSchema>

/**
 * One authored task, exactly {@link InterfaceSchema} minus the three fields
 * authoring does not own (`fingerprint`, `origin`, `contract`) and minus
 * `specOnly` (an OpenAPI-provenance marker, meaningless on a web task). Narrowed
 * to `web` so the outcome schema a driver renders is the web shape and nothing
 * else — a smaller schema is a clearer instruction.
 */
export const AuthoredTaskSchema = z
  .object({
    /** `web/<kebab-slug>`, unique across the whole catalog. */
    id: z.string().regex(AUTHORED_ID, 'an authored task id is `web/<kebab-slug>`'),
    type: z.literal(AUTHORED_SURFACE),
    /** What the user accomplishes, in their words — one line. */
    title: z.string().min(1),
    /** The family this task sits in (the screen's area: `repos`, `home`). */
    group: z.string().min(1).optional(),
    /** The address the task is performed at — `{method: "GET", path}`. */
    entry: InterfaceOperationEntrySchema,
    steps: z.array(AuthoredWebStepSchema).min(1),
    startingState: InterfaceStateIdSchema.optional(),
    endState: InterfaceStateIdSchema.optional(),
    at: InterfaceResourceIdSchema.optional(),
    to: InterfaceResourceIdSchema.optional(),
    /** Api interface ids this task's steps reach, `[]` when it reaches none. */
    apiEffects: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type AuthoredTask = z.infer<typeof AuthoredTaskSchema>

/**
 * A place the tasks need that no derivation produced — a dialog that opens over
 * a screen, a panel that swaps in on one. Screens derive (item 103), so a screen
 * here is the exception: an app whose routing idiom no reader recognizes.
 * `readables` is deliberately absent — see the file header.
 */
export const AuthoredPlaceSchema = z
  .object({
    id: InterfaceResourceIdSchema,
    kind: InterfaceResourceKindSchema,
    title: z.string().min(1),
    /** The place this one sits ON (a panel) or OVER (a dialog). A screen has none. */
    of: InterfaceResourceIdSchema.optional(),
    /** Screens only — the address a navigate step reaches it by. */
    address: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  })
  .strict()
export type AuthoredPlace = z.infer<typeof AuthoredPlaceSchema>

/**
 * What one session returns: the tasks it authored, the worlds they assume and
 * leave, the places they need, and what it could NOT establish. `unresolved` is
 * a first-class outcome, not a failure — a task the source does not state is a
 * recorded gap, and the alternative (guessing a control that is not there) is
 * the drift signal poisoned at the source.
 */
export const AuthoredFragmentSchema = z
  .object({
    interfaces: z.array(AuthoredTaskSchema),
    states: z.array(InterfaceStateSchema).optional(),
    resources: z.array(AuthoredPlaceSchema).optional(),
    /** What the reading could not settle, one line each — never a guess. */
    unresolved: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type AuthoredFragment = z.infer<typeof AuthoredFragmentSchema>

/**
 * The worlds the catalog already names, in catalog order, the authored file's
 * wording winning where both halves define an id. This is the registry a
 * session is briefed with and the one its draft is held to — one list, so what
 * a session is shown and what it is refused for cannot disagree.
 */
export function registryStates(
  derived: InterfacesFile | null,
  authored: InterfacesFile | null,
): InterfaceState[] {
  const byId = new Map<string, InterfaceState>()
  for (const state of [
    ...(derived?.states?.[AUTHORED_SURFACE] ?? []),
    ...(authored?.states?.[AUTHORED_SURFACE] ?? []),
  ]) {
    byId.set(state.id, state)
  }
  return [...byId.values()]
}

/** A task with the fingerprint computed for it — a complete {@link Interface}. */
export type StampedTask = AuthoredTask & { fingerprint: string }

/** Fingerprint every task of a fragment — the one field authoring never writes. */
export function stampFragment(fragment: AuthoredFragment): {
  interfaces: StampedTask[]
  states: InterfaceState[]
  resources: InterfaceResource[]
} {
  return {
    interfaces: fragment.interfaces.map((task) => ({
      ...task,
      fingerprint: interfaceFingerprint({ type: task.type, entry: task.entry, steps: task.steps }),
    })),
    states: [...(fragment.states ?? [])],
    resources: [...(fragment.resources ?? [])],
  }
}

export interface FragmentValidation {
  ok: boolean
  /** One line per problem, in the vocabulary the author used — never a stack. */
  errors: string[]
  /** The authored file the fragment WOULD produce; present only when `ok`. */
  authored?: InterfacesFile
}

export interface ValidateFragmentInput {
  /** The derived snapshot (`guard/interfaces.json`), or null when none exists. */
  derived: InterfacesFile | null
  /** The authored file as it stands on disk, or null when nothing is authored. */
  authored: InterfacesFile | null
  fragment: AuthoredFragment
  /**
   * Ids the fragment is allowed to REPLACE — the work item's own prior tasks on
   * a re-author. Anything else that collides is refused: the authored file is
   * committed, hand-owned work, and overwriting it is the one loss no derivation
   * can undo.
   */
  replaceable?: ReadonlySet<string>
  /**
   * The place this session was given. A session authors ONE screen — the tasks
   * performed on it, or on a dialog/panel that sits on it — so a task located
   * anywhere else belongs to another session's work item and would collide with
   * it. Absent when the caller is checking a fragment with no work item (a
   * hand-run check).
   */
  scope?: { screenId: string; address?: string }
}

/**
 * Hold a fragment to every rule at once and return the file it would produce.
 * The schema does the structural half (ids resolve in the area registry, a
 * screen sits on nothing, a state id is not a sentence); this adds the five
 * rules that are about AUTHORING rather than about the shape:
 *
 *  1. an id names one thing — no collision with a derived or authored entry;
 *  2. a fingerprint names one thing — the same task authored twice is one task,
 *     and its second copy would double every scenario grounded on it;
 *  3. a target is `<role> "<name>"` with a real ARIA role (§10.3's locator
 *     policy: an element with no role and no accessible name is not guessed at);
 *  4. a task is REACHABLE and says where it happens — `at`, or a first
 *     `navigate` step, and when both the address and the place are known they
 *     have to agree;
 *  5. a state id names one world catalog-wide — a draft references what the
 *     registry already defines and never redefines it as something else.
 */
export function validateFragment(input: ValidateFragmentInput): FragmentValidation {
  const { derived, authored, fragment } = input
  const replaceable = input.replaceable ?? new Set<string>()
  const errors: string[] = []
  const stamped = stampFragment(fragment)

  // ---- 1. one id, one thing ------------------------------------------------
  const seenIds = new Set<string>()
  for (const task of stamped.interfaces) {
    if (seenIds.has(task.id)) errors.push(`\`${task.id}\` is authored twice in this draft`)
    seenIds.add(task.id)
  }
  const derivedIds = new Set((derived?.interfaces ?? []).map((i) => i.id))
  const authoredIds = new Set((authored?.interfaces ?? []).map((i) => i.id))
  for (const task of stamped.interfaces) {
    if (derivedIds.has(task.id)) {
      errors.push(`\`${task.id}\` is the id of a DERIVED interface — authoring it would shadow the derivation`)
    } else if (authoredIds.has(task.id) && !replaceable.has(task.id)) {
      errors.push(`\`${task.id}\` is already authored — pick a new id, or re-author that place explicitly`)
    }
  }

  // ---- 2. one fingerprint, one task ---------------------------------------
  const twins = new Map<string, string>()
  for (const iface of [...(derived?.interfaces ?? []), ...(authored?.interfaces ?? [])]) {
    if (!replaceable.has(iface.id)) twins.set(iface.fingerprint, iface.id)
  }
  for (const task of stamped.interfaces) {
    const twin = twins.get(task.fingerprint)
    if (twin) {
      errors.push(
        `\`${task.id}\` is the same task as \`${twin}\` — same entry, same steps. One invocable thing is one entry.`,
      )
    }
    twins.set(task.fingerprint, task.id)
  }

  // ---- 3. the locator policy ----------------------------------------------
  const roles = new Set<string>(GUARD_WEB_ROLES)
  for (const task of stamped.interfaces) {
    task.steps.forEach((step, i) => {
      if (step.kind !== 'activate' && step.kind !== 'input') return
      const match = TARGET_GRAMMAR.exec(step.target)
      if (!match) {
        errors.push(
          `\`${task.id}\` step ${i + 1}: target \`${step.target}\` is not \`<role> "<accessible name>"\` — the locator policy is roles and names, never a selector`,
        )
        return
      }
      if (!roles.has(match[1])) {
        errors.push(`\`${task.id}\` step ${i + 1}: \`${match[1]}\` is not an ARIA role this vocabulary knows`)
      }
    })
  }

  // ---- 4. reachable, and located where it says -----------------------------
  const places = new Map<string, InterfaceResource>()
  for (const place of [
    ...(derived?.resources?.[AUTHORED_SURFACE] ?? []),
    ...(authored?.resources?.[AUTHORED_SURFACE] ?? []),
    ...stamped.resources,
  ]) {
    places.set(place.id, place as InterfaceResource)
  }
  for (const task of stamped.interfaces) {
    const first = task.steps[0]
    if (!task.at && first.kind !== 'navigate') {
      errors.push(
        `\`${task.id}\` says neither where it happens (\`at\`) nor how it gets there (a first \`navigate\` step) — a task nothing can reach cannot be run`,
      )
    }
    if (first.kind === 'navigate' && first.route !== task.entry.path) {
      errors.push(
        `\`${task.id}\` navigates to \`${first.route}\` but its entry is \`${task.entry.path}\` — the entry IS the address the task starts at`,
      )
    }
    const screen = task.at ? screenFor(task.at, places) : undefined
    if (screen?.address && screen.address !== task.entry.path) {
      errors.push(
        `\`${task.id}\` is \`at\` a place addressed \`${screen.address}\`, and its entry says \`${task.entry.path}\``,
      )
    }
    if (input.scope) {
      const located = task.at
        ? screen?.id
        : first.kind === 'navigate' && first.route === input.scope.address
          ? input.scope.screenId
          : undefined
      if (located !== input.scope.screenId) {
        errors.push(
          `\`${task.id}\` is not a task of \`${input.scope.screenId}\` — this session authors that place and the dialogs and panels on it`,
        )
      }
    }
  }

  // ---- 5. a state id names one world, catalog-wide -------------------------
  // The registry is what tasks chain BY: `at-least-one-repository-registered`
  // means the same world at every place, or the chain is a coincidence of
  // spelling. So a draft may REFERENCE any id the catalog defines (the schema
  // check below resolves it) and may DEFINE a new one, but it may not quietly
  // give an existing id a new meaning — every task already chained to it would
  // silently start asserting something else. Restating one verbatim is fine: a
  // re-author of a place hands back the states it handed back last time.
  const existingStates = new Map(registryStates(derived, authored).map((state) => [state.id, state]))
  for (const state of stamped.states) {
    const existing = existingStates.get(state.id)
    if (existing && existing.description !== state.description) {
      errors.push(
        `\`${state.id}\` already names "${existing.description}" — reference it without redefining it, or pick a new id if you mean a different world`,
      )
    }
  }

  // ---- the structural half: the merged catalog has to parse ---------------
  const candidate = candidateAuthored(authored, stamped, replaceable)
  const parsed = InterfacesFileSchema.safeParse(mergeInterfaceCatalogs(derived, candidate))
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.') || 'catalog'} — ${issue.message}`)
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [], authored: candidate }
}

/**
 * The authored file the fragment produces: the file on disk with the draft laid
 * over it by id, per area. Never a replacement — a session authors one place,
 * and the rest of the file is somebody else's work.
 */
export function candidateAuthored(
  authored: InterfacesFile | null,
  stamped: ReturnType<typeof stampFragment>,
  replaceable: ReadonlySet<string> = new Set(),
): InterfacesFile {
  const kept = (authored?.interfaces ?? []).filter(
    (iface) => !replaceable.has(iface.id) || stamped.interfaces.some((t) => t.id === iface.id),
  )
  return {
    version: 2,
    generatedAt: authored?.generatedAt ?? '',
    recipeFingerprint: authored?.recipeFingerprint ?? '',
    interfaces: overlay(kept, stamped.interfaces),
    ...registry('states', authored?.states, stamped.states),
    ...registry('resources', authored?.resources, stamped.resources),
  }
}

function registry<K extends 'states' | 'resources', T extends { id: string }>(
  key: K,
  existing: Record<string, T[]> | undefined,
  added: T[],
): Partial<Record<K, Record<string, T[]>>> {
  if (!existing && added.length === 0) return {}
  const merged: Record<string, T[]> = { ...(existing ?? {}) }
  if (added.length > 0) {
    merged[AUTHORED_SURFACE] = overlay(merged[AUTHORED_SURFACE] ?? [], added)
  }
  return { [key]: merged } as Partial<Record<K, Record<string, T[]>>>
}

/** Lay `additions` over `base` by id — an override keeps the base's position. */
function overlay<T extends { id: string }>(base: readonly T[], additions: readonly T[]): T[] {
  const byId = new Map(additions.map((entry) => [entry.id, entry]))
  const result = base.map((entry) => byId.get(entry.id) ?? entry)
  for (const entry of additions) {
    if (!base.some((b) => b.id === entry.id)) result.push(entry)
  }
  return result
}

/** The screen a place sits on, walking the `of` chain up; a screen is itself. */
function screenFor(
  id: string,
  places: ReadonlyMap<string, InterfaceResource>,
): InterfaceResource | undefined {
  const seen = new Set<string>()
  let current: string | undefined = id
  while (current && !seen.has(current)) {
    seen.add(current)
    const place: InterfaceResource | undefined = places.get(current)
    if (!place) return undefined
    if (place.kind === 'screen') return place
    current = place.of
  }
  return undefined
}
