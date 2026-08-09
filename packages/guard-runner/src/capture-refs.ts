/**
 * The capture cross-check: every rule about captured values that spans STEPS,
 * resolved at LOAD TIME.
 *
 * A capture is the one piece of a scenario whose meaning depends on ORDER — a name
 * is assigned once, and only the steps after that see it. The schema validates one
 * step at a time and so can say none of it; the runner discovering it mid-scenario
 * would spend a sandbox, a build and a run to report an authoring mistake as
 * infrastructure. So it reports through the SAME `ScenarioLoadError` channel a
 * malformed file does — loud at load, one error per defect, and never a run-time
 * surprise.
 *
 * The rules themselves live in `@truecourse/shared` (`captureDefects`), because the
 * authoring path checks the identical sentences before a scenario is ever written.
 */

import { captureDefects, type GuardScenario } from '@truecourse/shared'
import type { ScenarioLoadError } from './scenario-loader.js'

/** One load error per capture rule the loaded corpus breaks. Pure. */
export function crossCheckCaptureRefs(
  scenarios: ReadonlyArray<{ scenario: GuardScenario; file: string }>,
): ScenarioLoadError[] {
  const errors: ScenarioLoadError[] = []
  for (const { scenario, file } of scenarios) {
    for (const defect of captureDefects(scenario.steps, scenario.setup)) {
      errors.push({ file, message: defect.message })
    }
  }
  return errors
}
