/**
 * THE LIVE PROOF — a locator the accessibility tree cannot vouch for is proven
 * on the running app before a task may carry it.
 *
 * A role+name target is what the observed tree lists, so reading the tree was
 * the proof. A `css` locator and a declared `pick` are not in any tree: the
 * first addresses the implementation, the second a position among matches. So
 * `check_draft` opens the task's address in the signed-in browser, replays the
 * task's own clicks up to the step, and resolves the locator the way the runner
 * will: its scope must match exactly one element, its handle exactly one (or at
 * least as many as its `pick` names), and the element it resolves to must be
 * visible. A `css` locator with no live world to prove it on is refused — a
 * session working from source alone cannot know what a selector matches.
 */

import { z } from 'zod'
import {
  GuardWebLocatorSchema,
  describeWebLocator,
  interfaceStepLocator,
  isNonCanonicalLocator,
  type GuardWebLocator,
} from '@truecourse/shared'
import { hasAddressSlot } from '@truecourse/guard-runner'
import type { AuthoredTask } from './draft.js'
import type { LiveScreens } from './live-screen.js'

/** How many controls a proof may be told to activate before the task's own steps. */
const MAX_PROOF_ACTIVATIONS = 5

/**
 * How to reach a task's starting state for its proof, by task id: the filled
 * address (required when the entry carries a slot) and the controls to open
 * first (a menu holding a dialog's opener). The task's own clicks before the
 * proven step are replayed after these.
 */
export const LiveProofReachSchema = z.record(
  z.string().min(1),
  z
    .object({
      path: z.string().min(1).max(2000).optional(),
      activate: z.array(GuardWebLocatorSchema).max(MAX_PROOF_ACTIVATIONS).optional(),
    })
    .strict(),
)
export type LiveProofReach = z.infer<typeof LiveProofReachSchema>

/** One step whose locator has to be proven live. */
interface ProofTarget {
  task: AuthoredTask
  /** 0-based index of the step in the task. */
  step: number
  locator: GuardWebLocator
}

/** A step owes a live proof when its locator is non-canonical or declares a position. */
function owesProof(locator: GuardWebLocator): boolean {
  return isNonCanonicalLocator(locator) || locator.pick !== undefined || locator.within?.pick !== undefined
}

function proofTargets(tasks: readonly AuthoredTask[]): ProofTarget[] {
  return tasks.flatMap((task) =>
    task.steps.flatMap((step, index) => {
      if (step.kind === 'navigate') return []
      const locator = interfaceStepLocator(step)
      return owesProof(locator) ? [{ task, step: index, locator }] : []
    }),
  )
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
  for (const target of proofTargets(tasks)) {
    const where = `\`${target.task.id}\` step ${target.step + 1} (${describeWebLocator(target.locator)})`
    if (!live) {
      if (isNonCanonicalLocator(target.locator)) {
        problems.push(
          `${where} reaches its element through \`css\`, and this run has no live screen to prove it on — use a role+name or visible-attribute handle, or name the control in \`unresolved\``,
        )
      }
      continue
    }
    const route = replayRoute(target, reach[target.task.id])
    if ('problem' in route) {
      problems.push(`${where}: ${route.problem}`)
      continue
    }
    const probed = await live.observer.probe({ path: route.path, activate: route.activate, locator: target.locator })
    const at = `on ${route.path}${route.activate.length > 0 ? ` after ${route.activate.map((l) => describeWebLocator(l)).join(', ')}` : ''}`
    if (!probed.ok) {
      problems.push(`${where} could not be proven ${at}: ${probed.reason}`)
      continue
    }
    const problem = readingProblem(target.locator, probed.reading)
    if (problem) problems.push(`${where} ${problem} ${at}`)
  }
  return problems
}

/**
 * Where the proof opens and what it clicks: the reach's address (or the task's
 * entry when it has no slot), the reach's activations, then the task's own
 * clicks before the step. A navigate step part-way through moves the start there.
 */
function replayRoute(
  target: ProofTarget,
  reach: LiveProofReach[string] | undefined,
): { path: string; activate: GuardWebLocator[] } | { problem: string } {
  let path = reach?.path ?? target.task.entry.path
  const activate: GuardWebLocator[] = [...(reach?.activate ?? [])]
  for (const step of target.task.steps.slice(0, target.step)) {
    if (step.kind === 'navigate') {
      if (step.route === target.task.entry.path) continue
      if (hasAddressSlot(step.route)) {
        return { problem: `it follows a navigate to \`${step.route}\`, whose slot a proof cannot fill` }
      }
      path = step.route
      activate.length = 0
    } else if (step.kind === 'activate') {
      activate.push(interfaceStepLocator(step))
    }
  }
  if (hasAddressSlot(path)) {
    return {
      problem: `its entry \`${path}\` carries a slot — pass \`proof: {"${target.task.id}": {"path": "<the address with every slot filled from a seeded fixture>"}}\` so it can be proven live`,
    }
  }
  return { path, activate }
}

/** What is wrong with what the locator resolved to, or nothing when it held. */
function readingProblem(
  locator: GuardWebLocator,
  reading: { scopeMatches?: number; matches: number; visible: boolean },
): string | undefined {
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
