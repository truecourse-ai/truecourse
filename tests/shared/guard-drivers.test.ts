/**
 * The driver registry is the single source of driver knowledge, and two things
 * about it are load-bearing enough to pin.
 *
 * FIRST: `runnable` must track the code. The web runner shipped
 * (`guard-runner/src/drivers/web-driver.ts` → `webStepDriver`, wired into the
 * driver index, playwright-core a real dependency) while this row still read
 * `runnable: false` — so `guard generate` discarded every web claim and authored
 * no web scenario, on a repo whose reference corpus runs eleven of them. A
 * shipped driver with a stale row is invisible: nothing fails, work is silently
 * dropped (SPEC_GUARD_PLAN item 132).
 *
 * SECOND: a runnable driver must name the recipe block that PREPARES it. That
 * mapping used to be spelled as hardcoded `driver === 'cli' | 'api'` branches in
 * three places (generate's `driverPrepared`, its `missingPrepNoun`, and the
 * estimate's `preparedSurfaces`), so flipping the row above would still have
 * authored nothing — every one of them answered `false` for web. Keeping the key
 * on the row is what makes a new driver land by adding ONE row, as the file's
 * own contract promises.
 */

import { describe, it, expect } from 'vitest'
import { GUARD_DRIVERS, driverRecipeKey, isRunnableDriver } from '@truecourse/shared'

describe('the guard driver registry', () => {
  it('flips web runnable now that generate can author it', () => {
    // Runnable means authorable AND executable. The runner shipped long before
    // the authoring arm; flipping this row on the runner alone handed web tasks
    // CLI tooling (121 doomed sessions on documenso). It flipped for good only
    // with the flow worker's web arm — prompt, raw schema, surface-keyed parse.
    expect(isRunnableDriver('web')).toBe(true)
    expect(driverRecipeKey('web')).toBe('web')
  })

  it('names the preparing recipe block for every runnable driver', () => {
    for (const driver of GUARD_DRIVERS.filter((d) => d.runnable)) {
      expect(driverRecipeKey(driver.id), `${driver.id} names no recipe block`).toBeDefined()
    }
  })

  it('leaves a driver whose runner has not shipped unprepared and labelled', () => {
    // tui stands in for "recorded for coverage honesty" — the state web left.
    expect(isRunnableDriver('tui')).toBe(false)
    expect(driverRecipeKey('tui')).toBeUndefined()
    expect(GUARD_DRIVERS.find((d) => d.id === 'tui')?.waitingLabel).toBe('Needs TUI driver')
  })
})
