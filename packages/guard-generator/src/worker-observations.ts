import { createHash, randomUUID } from 'node:crypto'
import type { GuardDriverId, GuardExpectedRed, GuardFailureObservation, GuardScenarioResult } from '@truecourse/shared'
import { compareFailureObservations } from './failure-observation.js'

const yamlFingerprint = (yaml: string): string => createHash('sha256').update(yaml).digest('hex')

/** Evidence is scoped to one worker and exact submitted bytes, never a model-authored object. */
export class WorkerObservations {
  private readonly records = new Map<string, { sha: string; step: number; observation: GuardFailureObservation }>()

  constructor(private readonly surface: GuardDriverId, private readonly limit = 16) {}

  record(yaml: string, result: GuardScenarioResult): string | undefined {
    if (this.surface !== 'web' || result.outcome !== 'fail' || result.preparationFailure ||
      result.blockedPrecondition || result.failure?.observationUnavailable || !result.failure?.observation) return undefined
    const id = randomUUID()
    this.records.set(id, { sha: yamlFingerprint(yaml), step: result.failure.step,
      observation: structuredClone(result.failure.observation) })
    while (this.records.size > this.limit) this.records.delete(this.records.keys().next().value!)
    return id
  }

  resolve(yaml: string, predictions: readonly GuardExpectedRed[]): { expectedReds: GuardExpectedRed[] } | { error: string } {
    const expectedReds: GuardExpectedRed[] = []
    const steps = new Set<number>()
    for (const prediction of predictions) {
      if (!prediction.predictedActual.trim()) return { error: 'predictedActual must contain a non-whitespace observation.' }
      if (steps.has(prediction.step)) return { error: 'Declare only one prediction for the first failing step.' }
      steps.add(prediction.step)
      if (prediction.observation) return { error: 'Do not submit observation objects; use the observationId returned by run_scenario.' }
      const { observationId, ...payload } = prediction
      // Match the shared schema's canonical form even for non-tool callers.
      const red = { ...payload, predictedActual: payload.predictedActual.trim() }
      if (observationId !== undefined) {
        const observed = this.records.get(observationId)
        if (this.surface !== 'web' || !observed || observed.sha !== yamlFingerprint(yaml) || observed.step !== red.step)
          return { error: 'Unknown, expired, or changed-candidate observationId. Run this exact YAML through run_scenario again.' }
        expectedReds.push({ ...red, observation: structuredClone(observed.observation) })
      } else expectedReds.push(red)
    }
    return { expectedReds }
  }

  clear(): void { this.records.clear() }
}

/** Shared live/cache gate. A supported observation never falls back to prose. */
export function redObservationMismatch(result: GuardScenarioResult, predicted: GuardExpectedRed): string | undefined {
  if (!predicted.predictedActual.trim()) return 'predictedActual must contain a non-whitespace observation.'
  if (result.failure?.observationUnavailable) return `Typed web evidence is unavailable: ${result.failure.observationUnavailable}`
  if (predicted.observation || result.failure?.observation) {
    if (!predicted.observation) return 'This web failure requires an observationId from run_scenario for the exact candidate.'
    if (!result.failure?.observation) return 'The confirmation did not produce the required typed web observation.'
    return compareFailureObservations(predicted.observation, result.failure.observation)
  }
  const norm = (value: string): string => value.replace(/\s+/g, ' ').trim()
  return norm(result.failure?.actual ?? '').includes(norm(predicted.predictedActual))
    ? undefined : 'The confirmation actual does not match your predictedActual.'
}
