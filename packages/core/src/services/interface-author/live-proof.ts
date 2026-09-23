/**
 * THE LIVE PROOF — a locator the accessibility tree cannot vouch for is proven
 * on the running app before a task may carry it.
 *
 * A role+name target is what the observed tree lists, so reading the tree was
 * the proof. A `css` locator and a declared `pick` are not in any tree: the
 * first addresses the implementation, the second a position among matches. So
 * `check_draft` opens the task's address in the signed-in browser, walks the
 * page to each such step, and resolves the locator there the way the runner
 * will: its scope must match exactly one element, its handle exactly one (or at
 * least as many as its `pick` names), and the element it resolves to must be
 * visible. A `css` locator with no live world to prove it on is refused — a
 * session working from source alone cannot know what a selector matches.
 *
 * The world is the seed's and shared, so a proof never replays what could
 * change it. It replays the task's own steps only when every one before the
 * proven step is a click and the task declares no `endState` (a task that
 * changes the world states one). Any other task is walked by the actions the
 * session lists for it, which fill in the values an interface step does not
 * carry. Each task is proven on ONE fresh page: the walk passes its steps in
 * order and reads each owed locator as it reaches it.
 */

import { z } from 'zod'
import {
  GuardWebLocatorSchema,
  describeWebLocator,
  readableLocators,
  interfaceStepLocator,
  isNonCanonicalLocator,
  webLocatorKey,
  type GuardWebLocator,
  type InterfaceResource,
} from '@truecourse/shared'
import { addressFillsTemplate, hasAddressSlot, type LocatorProbeStep, type LocatorReading } from '@truecourse/guard-runner'
import type { AuthoredTask } from './draft.js'
import { observerFor, type LiveScreens } from './live-screen.js'

/** How many actions a proof may be told to take. */
const MAX_PROOF_STEPS = 10

/** One action a session lists to bring the page to a task's controls. */
const ProofActionSchema = z.union([
  z.object({ activate: GuardWebLocatorSchema }).strict(),
  z.object({ fill: GuardWebLocatorSchema, value: z.string().max(2000) }).strict(),
  z.object({ select: GuardWebLocatorSchema, option: z.string().min(1).max(500) }).strict(),
])
type ProofAction = z.infer<typeof ProofActionSchema>

/**
 * How to reach a task's controls for its proof, by task id: the filled address
 * (required when the entry carries a slot, and a filling of that entry), and
 * the actions to take on it in place of replaying the task's own steps.
 */
export const LiveProofReachSchema = z.record(
  z.string().min(1),
  z
    .object({
      path: z.string().min(1).max(2000).optional(),
      steps: z.array(ProofActionSchema).min(1).max(MAX_PROOF_STEPS).optional(),
    })
    .strict(),
)
export type LiveProofReach = z.infer<typeof LiveProofReachSchema>

/** One step whose locator has to be proven live. */
interface OwedStep {
  /** 0-based index of the step in the task. */
  step: number
  locator: GuardWebLocator
}

/** How one task is proven: the page's walk, the owed steps it reads and where, and the ones it cannot reach. */
interface ProofPlan {
  path: string
  steps: LocatorProbeStep[]
  /** One per `resolve` of the walk, in order: the step it proves, and the page state it is read in. */
  resolves: Array<{ target: OwedStep; at: string }>
  refused: Array<{ target: OwedStep; problem: string }>
}

/** A step owes a live proof when its locator is non-canonical or declares a position. */
function owesProof(locator: GuardWebLocator): boolean {
  return isNonCanonicalLocator(locator) || locator.pick !== undefined || locator.within?.pick !== undefined
}

function owedSteps(task: AuthoredTask): OwedStep[] {
  return task.steps.flatMap((step, index) => {
    if (step.kind !== 'input' && step.kind !== 'activate') return []
    const locator = interfaceStepLocator(step)
    return owesProof(locator) ? [{ step: index, locator }] : []
  })
}

/**
 * Prove every locator of `tasks` that owes a proof, on `live` when the run has
 * it. Returns one line per problem; an empty list means every one held.
 */
export async function proveLocators(
  tasks: readonly AuthoredTask[],
  live: LiveScreens | undefined,
  reach: LiveProofReach,
): Promise<string[]> {
  const problems: string[] = []
  for (const task of tasks) {
    const owed = owedSteps(task)
    if (owed.length === 0) continue
    const where = (target: OwedStep) =>
      `\`${task.id}\` step ${target.step + 1} (${describeWebLocator(target.locator)})`
    if (!live) {
      for (const target of owed.filter((o) => isNonCanonicalLocator(o.locator))) {
        problems.push(
          `${where(target)} reaches its element through \`css\`, and this run has no live screen to prove it on — use a role+name or visible-attribute handle, or name the control in \`unresolved\``,
        )
      }
      continue
    }
    const plan = proofPlan(task, owed, reach[task.id])
    for (const { target, problem } of plan.refused) problems.push(`${where(target)}: ${problem}`)
    if (plan.resolves.length === 0) continue
    const observer = observerFor(live, task.principal) ?? live.observer
    const probed = await observer.probe({ path: plan.path, steps: plan.steps })
    plan.resolves.forEach(({ target, at }, i) => {
      const reading: LocatorReading | undefined = probed.readings?.[i]
      if (!reading) {
        problems.push(`${where(target)} could not be proven ${at}: ${probed.ok ? 'the walk never reached it' : probed.reason}`)
        return
      }
      const problem = readingProblem(target.locator, reading)
      if (problem) problems.push(`${where(target)} ${problem} ${at}`)
    })
  }
  return problems
}

/**
 * Prove every readable locator of `places` that owes a proof, on `live` when the
 * run has it, at `address` — the screen the session authors. Returns one line
 * per problem; an empty list means every one held.
 */
export async function proveReadables(
  places: readonly InterfaceResource[],
  live: LiveScreens | undefined,
  reach: LiveProofReach,
  address: string | undefined,
): Promise<string[]> {
  const problems: string[] = []
  for (const place of places) {
    const owed = readableLocators(place).filter((readable) => owesProof(readable.locator))
    if (owed.length === 0) continue
    const where = (readable: (typeof owed)[number]) =>
      `\`${place.id}\` ${readable.kind}[${readable.index}]${readable.id ? ` (\`${readable.id}\`)` : ''} (${describeWebLocator(readable.locator)})`
    if (!live) {
      for (const readable of owed.filter((o) => isNonCanonicalLocator(o.locator))) {
        problems.push(
          `${where(readable)} reaches its element through \`css\`, and this run has no live screen to prove it on — use a role+name or visible-attribute handle, or leave the fact out and say why in \`unresolved\``,
        )
      }
      continue
    }
    const path = reach[place.id]?.path ?? address
    const refused = (problem: string) => owed.forEach((readable) => problems.push(`${where(readable)}: ${problem}`))
    if (path === undefined) {
      refused('its place has no address to prove it on')
      continue
    }
    if (reach[place.id]?.path !== undefined && address !== undefined && !addressFillsTemplate(path, address)) {
      refused(`the proof path \`${path}\` is not the screen's address \`${address}\` — fill each {slot} and change nothing else`)
      continue
    }
    if (hasAddressSlot(path)) {
      refused(`its screen's address \`${path}\` carries a slot — pass \`proof: {"${place.id}": {"path": "<the address with every slot filled from a seeded fixture>"}}\` so it can be proven live`)
      continue
    }
    const actions = reach[place.id]?.steps ?? []
    const at = pageState(path, actions.map(describeAction))
    const probed = await live.observer.probe({
      path,
      steps: [...actions, ...owed.map((readable) => ({ resolve: readable.locator }))],
    })
    owed.forEach((readable, i) => {
      const reading: LocatorReading | undefined = probed.readings?.[i]
      if (!reading) {
        problems.push(`${where(readable)} could not be proven ${at}: ${probed.ok ? 'the walk never reached it' : probed.reason}`)
        return
      }
      const problem = readingProblem(readable.locator, reading)
      if (problem) {
        problems.push(
          `${where(readable)} ${problem} ${at}${
            actions.length === 0 && place.kind !== 'screen'
              ? ` — a fact of a ${place.kind} is read once it is open: pass \`proof: {"${place.id}": {"steps": [...]}}\` listing the actions that open it`
              : ''
          }`,
        )
      }
    })
  }
  return problems
}

/**
 * Where the proof opens — the reach's address, which must fill the task's
 * entry, or the entry itself — and how it walks from there: by the session's
 * listed actions when it gave some, else by replaying the task.
 */
function proofPlan(task: AuthoredTask, owed: readonly OwedStep[], reach: LiveProofReach[string] | undefined): ProofPlan {
  const plan: ProofPlan = { path: reach?.path ?? task.entry.path, steps: [], resolves: [], refused: [] }
  const refuseAll = (problem: string): ProofPlan => ({ ...plan, refused: owed.map((target) => ({ target, problem })) })
  if (reach?.path !== undefined && !addressFillsTemplate(reach.path, task.entry.path)) {
    return refuseAll(
      `the proof path \`${reach.path}\` is not the task's entry \`${task.entry.path}\` — fill each {slot} of the entry and change nothing else`,
    )
  }
  if (hasAddressSlot(plan.path)) {
    return refuseAll(
      `its entry \`${plan.path}\` carries a slot — pass \`proof: {"${task.id}": {"path": "<the address with every slot filled from a seeded fixture>"}}\` so it can be proven live`,
    )
  }
  return reach?.steps ? listedWalk(plan, owed, reach.steps) : replayWalk(plan, task, owed)
}

/**
 * Walk the task's own steps up to its last owed one: each navigate reopens the
 * page (the entry, filled, when it names the entry), each click before the last
 * owed step is replayed, and each owed step is read where it stands. A step the
 * replay cannot reach — after an input, in a task that changes the world, after
 * a navigate whose slot nothing fills — is refused with what to do instead;
 * a later navigate makes the page reachable again.
 */
function replayWalk(plan: ProofPlan, task: AuthoredTask, owed: readonly OwedStep[]): ProofPlan {
  const byStep = new Map(owed.map((target) => [target.step, target]))
  const last = owed[owed.length - 1].step
  let path = plan.path
  let after: string[] = []
  let blocked: string | undefined
  for (const [i, step] of task.steps.slice(0, last + 1).entries()) {
    if (step.kind === 'navigate') {
      const route = step.route === task.entry.path ? plan.path : step.route
      if (hasAddressSlot(route)) {
        blocked = `it follows a navigate to \`${step.route}\`, whose slot a proof cannot fill`
        continue
      }
      if (route !== path || after.length > 0 || blocked) plan.steps.push({ navigate: route })
      path = route
      after = []
      blocked = undefined
      continue
    }
    if (step.kind !== 'input' && step.kind !== 'activate') continue
    const locator = interfaceStepLocator(step)
    const target = byStep.get(i)
    if (target && blocked) plan.refused.push({ target, problem: blocked })
    else if (target) {
      plan.steps.push({ resolve: locator })
      plan.resolves.push({ target, at: pageState(path, after) })
    }
    if (blocked || i === last) continue
    if (step.kind === 'input') blocked = cannotReplay(task, 'an input step comes before it, and an interface step carries no value to type')
    else if (task.endState) blocked = cannotReplay(task, `the task changes the world (endState \`${task.endState}\`), so its steps are not replayed on the shared seed`)
    else {
      plan.steps.push({ activate: locator })
      after.push(describeWebLocator(locator))
    }
  }
  return plan
}

/**
 * Walk the session's listed actions in place of the task's steps. An owed step
 * is read right before the action that acts on its locator, and any the list
 * never acts on are read once it ends.
 */
function listedWalk(plan: ProofPlan, owed: readonly OwedStep[], actions: readonly ProofAction[]): ProofPlan {
  const pending = [...owed]
  const after: string[] = []
  const resolve = (target: OwedStep) => {
    plan.steps.push({ resolve: target.locator })
    plan.resolves.push({ target, at: pageState(plan.path, after) })
  }
  for (const action of actions) {
    const acted = webLocatorKey(actionLocator(action))
    for (const target of pending.filter((t) => webLocatorKey(t.locator) === acted)) {
      resolve(target)
      pending.splice(pending.indexOf(target), 1)
    }
    plan.steps.push(action)
    after.push(describeAction(action))
  }
  pending.forEach(resolve)
  return plan
}

function actionLocator(action: ProofAction): GuardWebLocator {
  return 'activate' in action ? action.activate : 'fill' in action ? action.fill : action.select
}

function describeAction(action: ProofAction): string {
  if ('activate' in action) return describeWebLocator(action.activate)
  if ('fill' in action) return `filling ${describeWebLocator(action.fill)}`
  return `choosing ${JSON.stringify(action.option)} in ${describeWebLocator(action.select)}`
}

/** `on /links after button “More”` — the page state a locator was read in. */
function pageState(path: string, after: readonly string[]): string {
  return `on ${path}${after.length > 0 ? ` after ${after.join(', ')}` : ''}`
}

function cannotReplay(task: AuthoredTask, reason: string): string {
  return `${reason} — pass \`proof: {"${task.id}": {"steps": [...]}}\` listing, in order, the actions that bring the page to it (\`{"activate": <locator>}\`, \`{"fill": <locator>, "value": "<text>"}\`, \`{"select": <locator>, "option": "<label>"}\`), and never a control that submits, deletes, cancels or signs out`
}

/** What is wrong with what the locator resolved to, or nothing when it held. */
function readingProblem(locator: GuardWebLocator, reading: LocatorReading): string | undefined {
  if (reading.scopeMatches !== undefined && reading.scopeMatches !== 1) {
    return `has a \`within\` that matches ${reading.scopeMatches} elements — a scope must match exactly one`
  }
  if (reading.matches === 0) return 'matches nothing'
  if (locator.pick === undefined && reading.matches > 1) {
    return `matches ${reading.matches} elements — narrow it (a stable attribute, a \`within\`) or declare the position you mean with \`pick\``
  }
  if (typeof locator.pick === 'number' && locator.pick > reading.matches) {
    return `declares \`pick: ${locator.pick}\` past the ${reading.matches} element(s) it matches`
  }
  if (!reading.visible) return 'resolves to an element that is not visible'
  return undefined
}
