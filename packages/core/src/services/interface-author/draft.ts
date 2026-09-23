/**
 * THE DRAFT — what an authoring session is allowed to hand back, and every rule
 * it has to satisfy before a byte reaches `guard/interfaces.authored.json`.
 *
 * The session authors WEB TASKS: the half of the web surface no derivation
 * produces. Two things are deliberately NOT the model's to
 * write:
 *
 * - **The fingerprint.** It is `sha256` over `type` + `entry` + `steps`, with a
 *   step that resolves to a declared readable folding that readable's identity
 *   rather than its label ({@link resolvedInterfaceFingerprint}), so it is a
 *   FUNCTION of the draft, computed here. A model-written fingerprint is a fact
 *   that can disagree with its own entry, and every scenario grounded on it
 *   would inherit the disagreement.
 * - **`origin`.** Stamped by the merge that joins the two catalog halves, never
 *   declared by a file — the field exists precisely because a declared one lied
 *   for months (see {@link InterfaceOriginSchema}).
 *
 * The CONTRACT is absent for a third reason, and it is the schema's own: the
 * contract union has `cli` and `api` members only, and `contract.surface` must
 * equal the interface's type — a web task cannot carry one at all. What a web
 * place SHOWS is its resource's `readables`, authored from the same source
 * reading as its tasks, using the shared assertion vocabulary.
 *
 * Every rule below is checked against the MERGED catalog — the derived snapshot
 * joined with the authored file the draft would land in — because that is the
 * catalog every consumer reads. An id resolves, or a fingerprint collides,
 * against the whole thing or against nothing.
 */

import { z } from 'zod'
import {
  InterfaceOperationEntrySchema,
  InterfaceResourceIdSchema,
  InterfaceResourceSchema,
  InterfaceActivateStepSchema,
  InterfaceInputStepSchema,
  InterfaceNavigateStepSchema,
  InterfaceStateIdSchema,
  InterfaceStateSchema,
  InterfacesFileSchema,
  resolvedInterfaceFingerprint,
  type Interface,
  type InterfaceResource,
  type InterfaceState,
  type InterfacesFile,
} from '@truecourse/shared'
import { mergeInterfaceCatalogs } from '@truecourse/guard-runner'

/** The surface this pass authors. Web is the only one nothing derives. */
export const AUTHORED_SURFACE = 'web'

/** What a place has to answer for before the write path accepts it. */
const READABLE_KINDS = ['markers', 'elements', 'controls', 'rows'] as const

/** `web/<kebab-slug>` — the id shape every authored task is held to. */
const AUTHORED_ID = /^web\/[a-z0-9]+(?:-[a-z0-9]+)*$/

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
    purpose: z.enum(['task', 'control']).optional(),
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

/** A new place or an enrichment of this screen and its nested places. */
export const AuthoredPlaceSchema = InterfaceResourceSchema.refine(
  (place) => place.kind === 'screen' || place.kind === 'panel' || place.kind === 'dialog',
  { path: ['kind'], message: 'web authoring declares screens, panels and dialogs only' },
)
export type AuthoredPlace = z.infer<typeof AuthoredPlaceSchema>

/**
 * What one session returns: the tasks it authored, the worlds they assume and
 * leave, the places they need, what it could NOT establish, and what it found
 * wrong on the way. `unresolved` is a first-class outcome, not a failure — a
 * task the source does not state is a recorded gap, and the alternative
 * (guessing a control that is not there) is the drift signal poisoned at the
 * source.
 *
 * `findings` is the OTHER list, and the distinction is the whole reason there
 * are two: `unresolved` is a complaint about authorability (this session could
 * not establish something), while a finding is something it DID establish and
 * that contradicts what the repository claims elsewhere — a doc that describes a
 * control the source does not have, a derivation that disagrees with the module
 * it names. That is `reference/AUTHORING.md`'s transform-gaps contract: a
 * code-vs-docs discrepancy is a diagnostic, never resolved silently, and
 * preserved VERBATIM. The catalog has no home for a diagnostic by design (it is
 * run reporting, not interface data), so the run appends them to the findings
 * ledger instead.
 */
export const AuthoredFragmentSchema = z
  .object({
    /** New tasks, and this screen's existing tasks AMENDED under their own ids. */
    interfaces: z.array(AuthoredTaskSchema),
    /**
     * Ids of this screen's existing tasks that stand exactly as they are. Kept
     * tasks are not re-sent: the catalog keeps them byte for byte.
     */
    kept: z.array(z.string().min(1)).optional(),
    /** This screen's existing tasks that no longer exist in the source, each with why. */
    retired: z.array(z.object({ id: z.string().min(1), reason: z.string().min(1) }).strict()).optional(),
    states: z.array(InterfaceStateSchema).optional(),
    resources: z.array(AuthoredPlaceSchema).optional(),
    /** What the reading could not settle, one line each — never a guess. */
    unresolved: z.array(z.string().min(1)).optional(),
    /** Code-vs-docs discrepancies, one verbatim line each — the doc-bug feed. */
    findings: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type AuthoredFragment = z.infer<typeof AuthoredFragmentSchema>

/** A draft with nothing in it — where a session's accepted draft starts. */
export const EMPTY_FRAGMENT: AuthoredFragment = { interfaces: [] }

/**
 * Lay a freshly checked piece over the draft a session already has accepted.
 * A piece names what it is about and nothing else, so an id it re-sends is a
 * CORRECTION of that entry and an id it omits is left exactly as it was — which
 * is what lets a session fix one locator without resending the catalog. The
 * same goes for a decision about an existing task: the piece's word on an id
 * (kept, retired, or amended by re-sending it) replaces the draft's earlier one.
 */
export function foldAuthoredFragment(
  base: AuthoredFragment,
  addition: AuthoredFragment,
): AuthoredFragment {
  const decided = new Set([...(addition.kept ?? []), ...(addition.retired ?? []).map((entry) => entry.id)])
  const restated = new Set([...decided, ...addition.interfaces.map((task) => task.id)])
  return collapseAuthoredIds({
    interfaces: [...base.interfaces.filter((task) => !decided.has(task.id)), ...addition.interfaces],
    kept: [...(base.kept ?? []).filter((id) => !restated.has(id)), ...(addition.kept ?? [])],
    retired: [...(base.retired ?? []).filter((entry) => !restated.has(entry.id)), ...(addition.retired ?? [])],
    states: [...(base.states ?? []), ...(addition.states ?? [])],
    resources: [...(base.resources ?? []), ...(addition.resources ?? [])],
    unresolved: [...(base.unresolved ?? []), ...(addition.unresolved ?? [])],
    findings: [...(base.findings ?? []), ...(addition.findings ?? [])],
  })
}

/**
 * One entry per id, the LAST one winning — except a place, which is merged the
 * way the write path merges an enrichment over the catalog: a supplied readable
 * kind replaces that kind, an omitted one keeps what was established. The lists
 * that carry no id (`unresolved`, `findings`) keep their first appearance and
 * drop exact repeats.
 *
 * A STATE is kept only while one of the draft's own tasks references it. A
 * state definition exists to name the world a task assumes or leaves, so one
 * nothing in the draft chains to is not part of the draft — and that is what
 * lets a correction RENAME a world: the task moves to the new id, and the id it
 * left behind goes with it instead of riding along to the outcome. A state the
 * catalog already defines is unaffected; this prunes the fragment, never the
 * registry.
 *
 * Runs again AFTER {@link scopeFragmentIds}, because that is what makes a
 * screen-local id and its already-qualified twin the same entry.
 */
export function collapseAuthoredIds(fragment: AuthoredFragment): AuthoredFragment {
  const interfaces = new Map<string, AuthoredTask>()
  for (const task of fragment.interfaces) interfaces.set(task.id, task)
  const referenced = new Set<string>()
  for (const task of interfaces.values()) {
    if (task.startingState) referenced.add(task.startingState)
    if (task.endState) referenced.add(task.endState)
  }
  const states = new Map<string, InterfaceState>()
  for (const state of fragment.states ?? []) {
    if (referenced.has(state.id)) states.set(state.id, state)
  }
  const resources = new Map<string, AuthoredPlace>()
  for (const place of fragment.resources ?? []) {
    const prior = resources.get(place.id)
    resources.set(place.id, {
      ...prior,
      ...place,
      ...(place.readables ? { readables: { ...prior?.readables, ...place.readables } } : {}),
    })
  }
  const lines = (values: readonly string[] | undefined): string[] => [...new Set(values ?? [])]
  const unresolved = lines(fragment.unresolved)
  const findings = lines(fragment.findings)
  const kept = lines(fragment.kept)
  const retired = [...new Map((fragment.retired ?? []).map((entry) => [entry.id, entry])).values()]
  return {
    interfaces: [...interfaces.values()],
    ...(kept.length > 0 ? { kept } : {}),
    ...(retired.length > 0 ? { retired } : {}),
    ...(states.size > 0 ? { states: [...states.values()] } : {}),
    ...(resources.size > 0 ? { resources: [...resources.values()] } : {}),
    ...(unresolved.length > 0 ? { unresolved } : {}),
    ...(findings.length > 0 ? { findings } : {}),
  }
}

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

/**
 * Fingerprint every task of a fragment — the one field authoring never writes.
 *
 * With the draft's PLACES in hand, a step whose locator matches a readable the
 * place declares folds that readable's identity instead of its label
 * ({@link resolvedInterfaceFingerprint}), so re-wording a control no longer
 * re-authors the scenarios grounded on the task. Without them (a bare check of
 * a fragment) every step keeps its label, which is the fingerprint every stored
 * catalog already carries.
 */
export function stampFragment(
  fragment: AuthoredFragment,
  places?: ReadonlyMap<string, InterfaceResource>,
): {
  interfaces: StampedTask[]
  states: InterfaceState[]
  resources: InterfaceResource[]
} {
  return {
    interfaces: fragment.interfaces.map((task) => ({
      ...task,
      fingerprint: resolvedInterfaceFingerprint(
        { type: task.type, entry: task.entry, steps: task.steps },
        task.at ? places?.get(task.at) : undefined,
      ),
    })),
    states: [...(fragment.states ?? [])],
    resources: [...(fragment.resources ?? [])],
  }
}

/**
 * Every web place a draft stands on: both catalog halves, with the draft's own
 * enrichments laid over them exactly as the write path lays them (a supplied
 * readable kind replaces that kind, an omitted one keeps what was established).
 * This is what a step's locator resolves against, and what the file records —
 * one merge, so the stamped identity and the stored place cannot disagree.
 */
export function draftPlaceIndex(
  derived: InterfacesFile | null,
  authored: InterfacesFile | null,
  resources: readonly InterfaceResource[] = [],
): Map<string, InterfaceResource> {
  const places = new Map<string, InterfaceResource>()
  for (const place of [
    ...(derived?.resources?.[AUTHORED_SURFACE] ?? []),
    ...(authored?.resources?.[AUTHORED_SURFACE] ?? []),
    ...resources,
  ]) {
    const prior = places.get(place.id)
    places.set(place.id, {
      ...prior,
      ...place,
      ...(place.readables ? { readables: { ...prior?.readables, ...place.readables } } : {}),
    })
  }
  return places
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
   * The work item's own prior tasks — the only ids the fragment may amend or
   * retire, and the ones it has to ACCOUNT for: each is kept, amended (re-sent
   * under its id) or retired with a reason. Anything else that collides is
   * refused: the authored file is hand-owned work, and overwriting it is the
   * one loss no derivation can undo.
   */
  replaceable?: ReadonlySet<string>
  /**
   * Treat a prior task the fragment does not account for as kept rather than
   * refusing the fragment. A live session is held to the accounting; a cached
   * fragment written against another catalog is not, and what it never
   * mentioned stays as it is.
   */
  carryUnaccounted?: boolean
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
 * screen sits on nothing, a state id is not a sentence, a step's target is one
 * locator handle and a `css` one says why); this adds the rules that are about
 * AUTHORING rather than about the shape:
 *
 *  1. an id names one thing — no collision with a derived or authored entry;
 *  2. a fingerprint names one thing — the same task authored twice is one task,
 *     and its second copy would double every scenario grounded on it;
 *  3. a task is REACHABLE and says where it happens — `at`, or a first
 *     `navigate` step, and when both the address and the place are known they
 *     have to agree;
 *  4. a state id names one world catalog-wide — a draft references what the
 *     registry already defines and never redefines it as something else;
 *  5. a place the draft declares answers for all four readable kinds, counting
 *     what this screen's earlier sessions established — an omitted kind is
 *     unknown, and nothing returns to a screen the ledger has settled;
 *  6. every one of this screen's existing tasks is accounted for — kept,
 *     amended or retired — exactly once ({@link accountForPrior});
 *  7. an opener is not a task on its own — a task that leaves the user at a
 *     dialog or a panel (`to`) is matched by a task performed there (or on a
 *     place nested in it), in the draft or the catalog, or by an `unresolved`
 *     line naming that place ({@link unservedOpenedPlaces}).
 */
export function validateFragment(input: ValidateFragmentInput): FragmentValidation {
  const { derived, authored } = input
  const draft = AuthoredFragmentSchema.safeParse(input.fragment)
  if (!draft.success) {
    return { ok: false, errors: draft.error.issues.map((issue) => `${issue.path.join('.')} — ${issue.message}`) }
  }
  const fragment = draft.data
  const errors: string[] = []
  // ---- 6. every existing task accounted for --------------------------------
  const accounting = accountForPrior(fragment, input.replaceable ?? new Set<string>())
  errors.push(...accounting.errors)
  if (!input.carryUnaccounted && accounting.unaccounted.length > 0) {
    errors.push(
      `this screen's existing task(s) ${accounting.unaccounted.map((id) => `\`${id}\``).join(', ')} are not accounted for — list each in \`kept\` when it stands as it is, re-send it under its id when it changed, or put it in \`retired\` with the reason it is gone`,
    )
  }
  // What the fragment may overwrite: its amendments and retirements, never a
  // task it keeps or (on a carried fragment) never mentioned.
  const replaceable = accounting.replaceable
  // The places the draft would leave behind — built before the tasks are
  // stamped, because a step's identity resolves against the readables the same
  // fragment declares.
  const drafted = draftPlaceIndex(derived, authored, fragment.resources ?? [])
  const stamped = stampFragment(fragment, drafted)

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
  // A web entry is indexed under its STORED key and under the key it would be
  // stamped with now: the two differ for every task authored before its place
  // declared its readables, and a duplicate must be caught under either.
  const twins = new Map<string, string>()
  for (const iface of [...(derived?.interfaces ?? []), ...(authored?.interfaces ?? [])]) {
    if (replaceable.has(iface.id)) continue
    twins.set(iface.fingerprint, iface.id)
    if (iface.type === AUTHORED_SURFACE) {
      twins.set(
        resolvedInterfaceFingerprint(iface, iface.at ? drafted.get(iface.at) : undefined),
        iface.id,
      )
    }
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

  // ---- 3. reachable, and located where it says -----------------------------
  const places = new Map<string, InterfaceResource>()
  const existingPlaces = new Map(
    (mergeInterfaceCatalogs(derived, authored)?.resources?.[AUTHORED_SURFACE] ?? []).map((place) => [place.id, place]),
  )
  const seenPlaces = new Set<string>()
  for (const place of stamped.resources) {
    if (seenPlaces.has(place.id)) errors.push(`\`${place.id}\` is declared twice in this draft`)
    seenPlaces.add(place.id)
    const prior = existingPlaces.get(place.id)
    // Enrichment cannot change another task's location or move a derived route.
    for (const key of ['kind', 'of', 'address'] as const) {
      if (prior && place[key] !== undefined && prior[key] !== undefined && place[key] !== prior[key]) {
        errors.push(`\`${place.id}\` cannot change its existing \`${key}\` during authoring`)
      }
    }
  }
  const candidate = candidateAuthored(authored, stamped, replaceable, derived)
  for (const place of mergeInterfaceCatalogs(derived, candidate)?.resources?.[AUTHORED_SURFACE] ?? []) {
    places.set(place.id, place)
  }
  if (input.scope) {
    for (const place of stamped.resources) {
      if (screenFor(place.id, places)?.id !== input.scope.screenId) {
        errors.push(`\`${place.id}\` is not a resource of \`${input.scope.screenId}\` — enrich only this screen and its nested places`)
      }
    }
  }

  // ---- 5. a declared place answers for all four readable kinds -------------
  // An omitted kind means UNKNOWN, and the run has no way back to it: the
  // screen's ledger row says the session settled, so nobody reads that place
  // again. The four arrays are cheap to state and the empty one is a claim, so
  // the session states them — they are never filled in here, because "the page
  // shows nothing of this kind" is a reading nobody but the session made.
  for (const place of stamped.resources) {
    const readables = places.get(place.id)?.readables
    const unstated = READABLE_KINDS.filter((kind) => readables?.[kind] === undefined)
    if (unstated.length > 0) {
      errors.push(
        `\`${place.id}\` leaves ${unstated.map((kind) => `\`${kind}\``).join(', ')} unstated — state each of \`markers\`, \`elements\`, \`controls\` and \`rows\` explicitly, \`[]\` when this place has none of that kind`,
      )
    }
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

  // ---- 7. an opener is not a task on its own --------------------------------
  const merged = mergeInterfaceCatalogs(derived, candidate)
  for (const { task, place } of unservedOpenedPlaces(stamped.interfaces, merged?.interfaces ?? [], places, fragment.unresolved ?? [])) {
    errors.push(
      `\`${task}\` opens \`${place.id}\` (${place.kind} "${place.title}"), and no task is performed there — read the component it opens and author what a user does in it (including cancelling or closing it) \`at: "${place.id}"\`, or add an \`unresolved\` line naming \`${place.id}\` and why its controls could not be authored`,
    )
  }

  // ---- 4. a state id names one world, catalog-wide -------------------------
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
  const parsed = InterfacesFileSchema.safeParse(merged)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.') || 'catalog'} — ${issue.message}`)
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [], authored: candidate }
}

/**
 * The dialogs and panels the draft's tasks open (`to`) that nothing serves: no
 * task of the merged catalog is performed at the place or at one nested in it,
 * and no `unresolved` line names it by id or by title. One entry per place, with
 * the first task that opens it.
 */
export function unservedOpenedPlaces(
  openers: readonly Pick<AuthoredTask, 'id' | 'to'>[],
  catalog: readonly Pick<Interface, 'at'>[],
  places: ReadonlyMap<string, InterfaceResource>,
  unresolved: readonly string[],
): { task: string; place: InterfaceResource }[] {
  const served = new Set<string>()
  for (const task of catalog) {
    const seen = new Set<string>()
    for (let id = task.at; id !== undefined && !seen.has(id); id = places.get(id)?.of) {
      seen.add(id)
      served.add(id)
    }
  }
  const lines = unresolved.map((line) => line.toLowerCase())
  const named = (place: InterfaceResource) =>
    lines.some((line) => line.includes(place.id.toLowerCase()) || line.includes(place.title.toLowerCase()))
  const unserved = new Map<string, { task: string; place: InterfaceResource }>()
  for (const task of openers) {
    const place = task.to ? places.get(task.to) : undefined
    if (!place || (place.kind !== 'dialog' && place.kind !== 'panel')) continue
    if (served.has(place.id) || unserved.has(place.id) || named(place)) continue
    unserved.set(place.id, { task: task.id, place })
  }
  return [...unserved.values()]
}

/**
 * The fragment's word on each of the screen's existing tasks. An id is KEPT
 * (listed in `kept`), AMENDED (re-sent in `interfaces` under its own id) or
 * RETIRED (listed in `retired` with a reason) — one of the three, and only an
 * id that IS one of them. `replaceable` is what the write may overwrite: the
 * amended and the retired.
 */
export function accountForPrior(
  fragment: AuthoredFragment,
  prior: ReadonlySet<string>,
): { replaceable: Set<string>; unaccounted: string[]; errors: string[] } {
  const errors: string[] = []
  const kept = new Set(fragment.kept ?? [])
  const retired = new Set((fragment.retired ?? []).map((entry) => entry.id))
  const amended = new Set(fragment.interfaces.map((task) => task.id).filter((id) => prior.has(id)))
  for (const id of [...kept, ...retired]) {
    if (!prior.has(id)) errors.push(`\`${id}\` is not one of this screen's existing tasks — only those are kept or retired`)
  }
  for (const id of kept) {
    if (retired.has(id)) errors.push(`\`${id}\` is both kept and retired`)
    if (amended.has(id)) errors.push(`\`${id}\` is both kept and re-sent — re-send it only when it changed`)
  }
  for (const id of retired) {
    if (amended.has(id)) errors.push(`\`${id}\` is both retired and re-sent`)
  }
  const unaccounted = [...prior].filter((id) => !kept.has(id) && !retired.has(id) && !amended.has(id)).sort()
  return { replaceable: new Set([...prior].filter((id) => retired.has(id) || amended.has(id))), unaccounted, errors }
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
  derived: InterfacesFile | null = null,
): InterfacesFile {
  const kept = (authored?.interfaces ?? []).filter(
    (iface) => !replaceable.has(iface.id) || stamped.interfaces.some((t) => t.id === iface.id),
  )
  // Catalog merging overlays whole resources. Materialize each enrichment over
  // both prior halves before storing it, retaining omitted fields and readable
  // kinds. An explicit [] replaces a kind; absence never erases established facts.
  const merged = draftPlaceIndex(derived, authored, stamped.resources)
  const resources = stamped.resources.map((place) => merged.get(place.id)!)
  return {
    version: 2,
    generatedAt: authored?.generatedAt ?? '',
    recipeFingerprint: authored?.recipeFingerprint ?? '',
    interfaces: overlay(kept, stamped.interfaces),
    ...registry('states', authored?.states, stamped.states),
    ...registry('resources', authored?.resources, resources),
    // The authoring ledger is bookkeeping about the file's own sessions, so it
    // travels untouched: this fragment's own row is recorded by the run's fold,
    // after the outcome is known.
    ...(authored?.authoring ? { authoring: authored.authoring } : {}),
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
