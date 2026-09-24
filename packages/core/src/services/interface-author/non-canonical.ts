/**
 * THE NON-CANONICAL RECORD — `guard/interfaces.noncanonical.json`, every authored
 * step and every readable that reaches its element through `css`, with the reason
 * it gave.
 *
 * A `css` locator exists because the app gives a control no handle a user or an
 * assistive reader can find it by. That is a fact about the app worth reporting
 * on its own, so the catalog's non-canonical locators are listed in one place:
 * a step's screen, task and position, a readable's place and kind, the locator
 * and its `why`. The list is DERIVED from the catalog after each authoring run,
 * never appended, so it always says what the catalog holds now.
 */

import fs from 'node:fs'
import {
  interfaceStepLocator,
  isNonCanonicalLocator,
  isRootPlace,
  isTargetedStep,
  readableLocators,
  type GuardWebLocator,
  type InterfaceEntry,
  type InterfaceReadableKind,
  type InterfaceResource,
  type InterfacesFile,
} from '@truecourse/shared'
import { guardNonCanonicalLocatorsPath } from '@truecourse/shared/work-tree'
import { atomicWriteJson, readMergedInterfaceCatalog } from '@truecourse/guard-runner'
import { AUTHORED_SURFACE } from './draft.js'

/** One step, or one readable, whose locator is non-canonical. */
export type NonCanonicalLocator =
  | {
      kind: 'step'
      /** The screen the task is performed on, when its location resolves to one. */
      screen?: string
      task: string
      /** 1-based, the way a reader counts a task's steps. */
      step: number
      locator: GuardWebLocator
      why: string
      /** Set when no browser vouched for the selector: it was written from source on a screen no principal reaches. */
      proven?: false
    }
  | {
      kind: 'readable'
      /** The screen the place sits on, when it resolves to one. */
      screen?: string
      place: string
      readable: InterfaceReadableKind
      /** 1-based within its kind. */
      index: number
      id?: string
      locator: GuardWebLocator
      why: string
      /** Set when no browser vouched for the selector: it was written from source on a screen no principal reaches. */
      proven?: false
    }

/**
 * Every non-canonical locator the catalog carries, in catalog order: the web
 * tasks' steps first, then the web places' readables.
 */
export function nonCanonicalLocators(catalog: InterfacesFile | null): NonCanonicalLocator[] {
  const places = new Map((catalog?.resources?.[AUTHORED_SURFACE] ?? []).map((place) => [place.id, place]))
  const steps = (catalog?.interfaces ?? [])
    .filter((task) => task.type === AUTHORED_SURFACE)
    .flatMap((task) => {
      const screen = task.at ? screenOf(task.at, places) : screenAt(task.entry, places)
      return task.steps.flatMap((step, index): NonCanonicalLocator[] => {
        if (!isTargetedStep(step) || step.kind === 'upload') return []
        const locator = interfaceStepLocator(step)
        if (!isNonCanonicalLocator(locator)) return []
        return [{
          kind: 'step',
          ...(screen ? { screen } : {}),
          task: task.id,
          step: index + 1,
          locator,
          why: step.why ?? '',
          ...(step.proven === false ? { proven: false as const } : {}),
        }]
      })
    })
  const readables = [...places.values()].flatMap((place) => {
    const screen = screenOf(place.id, places)
    return readableLocators(place)
      .filter((readable) => isNonCanonicalLocator(readable.locator))
      .map((readable): NonCanonicalLocator => ({
        kind: 'readable',
        ...(screen ? { screen } : {}),
        place: place.id,
        readable: readable.kind,
        index: readable.index + 1,
        ...(readable.id ? { id: readable.id } : {}),
        locator: readable.locator,
        why: readable.why ?? '',
        ...(readable.proven === false ? { proven: false as const } : {}),
      }))
  })
  return [...steps, ...readables]
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

/** The root place (screen or shared component) a place sits on, walking the `of` chain up; a root is itself. */
function screenOf(id: string, places: ReadonlyMap<string, InterfaceResource>): string | undefined {
  const seen = new Set<string>()
  for (let place = places.get(id); place && !seen.has(place.id); place = place.of ? places.get(place.of) : undefined) {
    seen.add(place.id)
    if (isRootPlace(place)) return place.id
  }
  return undefined
}

/** The screen addressed at a task's entry path, when one is. */
function screenAt(entry: InterfaceEntry, places: ReadonlyMap<string, InterfaceResource>): string | undefined {
  if (!('path' in entry)) return undefined
  return [...places.values()].find((place) => place.kind === 'screen' && place.address === entry.path)?.id
}
