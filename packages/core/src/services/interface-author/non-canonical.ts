/**
 * THE NON-CANONICAL RECORD — `guard/interfaces.noncanonical.json`, every authored
 * step that reaches its element through `css`, with the reason the task gave.
 *
 * A `css` locator exists because the app gives a control no handle a user or an
 * assistive reader can find it by. That is a fact about the app worth reporting
 * on its own, so the catalog's non-canonical steps are listed in one place:
 * the screen, the task, the step, the locator and its `why`. The list is DERIVED
 * from the catalog after each authoring run, never appended, so it always says
 * what the catalog holds now.
 */

import fs from 'node:fs'
import {
  interfaceStepLocator,
  isNonCanonicalLocator,
  type GuardWebLocator,
  type InterfaceEntry,
  type InterfaceResource,
  type InterfacesFile,
} from '@truecourse/shared'
import { guardNonCanonicalLocatorsPath } from '@truecourse/shared/work-tree'
import { atomicWriteJson, readMergedInterfaceCatalog } from '@truecourse/guard-runner'
import { AUTHORED_SURFACE } from './draft.js'

/** One step whose locator is non-canonical. */
export interface NonCanonicalLocator {
  /** The screen the task is performed on, when its location resolves to one. */
  screen?: string
  task: string
  /** 1-based, the way a reader counts a task's steps. */
  step: number
  locator: GuardWebLocator
  why: string
}

/** Every non-canonical step locator the catalog's web tasks carry, in catalog order. */
export function nonCanonicalLocators(catalog: InterfacesFile | null): NonCanonicalLocator[] {
  const places = new Map((catalog?.resources?.[AUTHORED_SURFACE] ?? []).map((place) => [place.id, place]))
  return (catalog?.interfaces ?? [])
    .filter((task) => task.type === AUTHORED_SURFACE)
    .flatMap((task) => {
      const screen = task.at ? screenOf(task.at, places) : screenAt(task.entry, places)
      return task.steps.flatMap((step, index) => {
        if (step.kind !== 'input' && step.kind !== 'activate') return []
        const locator = interfaceStepLocator(step)
        if (!isNonCanonicalLocator(locator)) return []
        return [{ ...(screen ? { screen } : {}), task: task.id, step: index + 1, locator, why: step.why ?? '' }]
      })
    })
}

/**
 * Regenerate the record from the merged catalog in `repoRoot`. A catalog with
 * no non-canonical step leaves no file, so a stale one is removed.
 */
export function writeNonCanonicalLocators(repoRoot: string): { path: string; count: number } {
  const path = guardNonCanonicalLocatorsPath(repoRoot)
  const locators = nonCanonicalLocators(readMergedInterfaceCatalog(repoRoot))
  if (locators.length === 0) fs.rmSync(path, { force: true })
  else atomicWriteJson(path, { locators })
  return { path, count: locators.length }
}

/** The screen a place sits on, walking the `of` chain up; a screen is itself. */
function screenOf(id: string, places: ReadonlyMap<string, InterfaceResource>): string | undefined {
  const seen = new Set<string>()
  for (let place = places.get(id); place && !seen.has(place.id); place = place.of ? places.get(place.of) : undefined) {
    seen.add(place.id)
    if (place.kind === 'screen') return place.id
  }
  return undefined
}

/** The screen addressed at a task's entry path, when one is. */
function screenAt(entry: InterfaceEntry, places: ReadonlyMap<string, InterfaceResource>): string | undefined {
  if (!('path' in entry)) return undefined
  return [...places.values()].find((place) => place.kind === 'screen' && place.address === entry.path)?.id
}
