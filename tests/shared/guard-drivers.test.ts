/**
 * The driver registry is the single source of driver knowledge, and one thing
 * about it is load-bearing enough to pin: a driver must name the recipe block
 * that PREPARES it.
 *
 * That mapping used to be spelled as hardcoded `driver === 'cli' | 'api'`
 * branches in three places (generate's `driverPrepared`, its `missingPrepNoun`,
 * and the estimate's `preparedSurfaces`), so flipping a row to runnable would
 * still have authored nothing — every one of them answered `false` for web.
 * Keeping the key on the row is what makes a new driver land by adding ONE row,
 * as the file's own contract promises.
 */

import { describe, it, expect } from 'vitest'
import { GUARD_DRIVERS, driverRecipeKey, isRunnableDriver } from '@truecourse/shared'

describe('the guard driver registry', () => {
  it('names the preparing recipe block for every runnable driver', () => {
    for (const driver of GUARD_DRIVERS.filter((d) => d.runnable)) {
      expect(driverRecipeKey(driver.id), `${driver.id} names no recipe block`).toBeDefined()
    }
  })

  it('carries web’s recipe block while its runner is still awaited', () => {
    // Runnable means authorable AND executable. Web is mapped and recorded today,
    // and its recipe block is already the one that would prepare it — flipping the
    // row is then the whole change, with nothing else to find.
    expect(isRunnableDriver('web')).toBe(false)
    expect(driverRecipeKey('web')).toBe('web')
  })

  it('leaves a driver with neither runner nor preparation unprepared and labelled', () => {
    expect(isRunnableDriver('tui')).toBe(false)
    expect(driverRecipeKey('tui')).toBeUndefined()
    expect(GUARD_DRIVERS.find((d) => d.id === 'tui')?.waitingLabel).toBe('Needs TUI driver')
  })
})
