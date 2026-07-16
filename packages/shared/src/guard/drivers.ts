/**
 * The guard driver registry — the SINGLE source of driver knowledge for the whole
 * guard subsystem. Every place that used to hand-spell "cli is the driver" (a
 * literal branch, a baked status list, a group tag, driver-scoped UI copy) reads
 * from here instead, so a new driver lands by adding ONE row below and nothing
 * else has to be found and edited (the plan's "Engineering rule": derive by data,
 * never fine-tune to the current case).
 *
 * A driver is `runnable` when its scenarios can be authored AND executed today
 * (the `cli` and `api` drivers). A non-runnable driver is RECORDED for coverage honesty — its
 * sections are classified and surface as "awaiting-driver" gaps — but no scenario
 * is authored or run until the driver ships. `waitingLabel` is the UI copy for
 * that awaiting state ("Needs web driver").
 *
 * ── The driver contract (how api/web/tui/… land additively) ──────────────────
 * When driver #2 ships it contributes exactly three NEW things, each keyed off its
 * `id` here so this registry stays the index:
 *   1. a per-driver closed VERB SUB-SCHEMA (its `setup`/`steps` vocabulary), keyed
 *      by the `driver` value — the scenario envelope itself never changes;
 *   2. a RUNNER MODULE (sandbox/environment provisioner + verb executor + evidence
 *      capture + normalizer additions) that flips its row to `runnable: true`;
 *   3. a RECIPE KIND for its preparation layer (cli = build + entrypoint; api =
 *      environment compose + datastore boot; …).
 * Nothing else moves — stores, section anchoring, the manifest, the dashboard
 * status model, and the generate pipeline are all driver-agnostic and derive from
 * the arrays below. This comment is the map; the code stays speculative-free.
 */

import { z } from 'zod'

/** One driver's registry row. */
export interface GuardDriverDef {
  /** Stable identifier — the `driver` value in scenarios, verdicts, and gaps. */
  id: string
  /** Human label for driver-scoped UI clusters ("CLI", "API"). */
  label: string
  /** Authorable AND executable today; false = recorded-only until the driver ships. */
  runnable: boolean
  /** UI copy for a section awaiting this (non-runnable) driver. */
  waitingLabel?: string
}

/**
 * The drivers, in canonical order. `cli` and `api` are runnable today; the
 * rest are recorded for coverage honesty. ADD A ROW to introduce a driver — every
 * derived array, schema, status, and label below picks it up automatically.
 *
 * NOTE: the id ORDER here is load-bearing for prompt stability — `guardDriverIds`
 * feeds the extraction schema's `driver` enum, whose rendered JSON-schema hint is
 * fingerprinted. Keep `cli, api, web, tui, library` in this order; new drivers
 * append at the end.
 */
export const GUARD_DRIVERS = [
  { id: 'cli', label: 'CLI', runnable: true },
  { id: 'api', label: 'API', runnable: true },
  { id: 'web', label: 'Web', runnable: false, waitingLabel: 'Needs web driver' },
  { id: 'tui', label: 'TUI', runnable: false, waitingLabel: 'Needs TUI driver' },
  { id: 'library', label: 'Library', runnable: false, waitingLabel: 'Needs library driver' },
] as const satisfies readonly GuardDriverDef[]

/** Every driver id (`cli | api | web | tui | library`), derived from the registry rows. */
export type GuardDriverId = (typeof GUARD_DRIVERS)[number]['id']

/** The non-runnable ("awaiting") driver ids — sections wait on these. */
export type GuardAwaitingDriverId = Extract<(typeof GUARD_DRIVERS)[number], { runnable: false }>['id']

/** All driver ids as a non-empty tuple — the source for `z.enum` (which needs one). */
export const guardDriverIds = GUARD_DRIVERS.map((d) => d.id) as [GuardDriverId, ...GuardDriverId[]]

/** Ids of drivers that can be authored + run today (`['cli', 'api']`). */
export const runnableDriverIds: readonly GuardDriverId[] = GUARD_DRIVERS.filter((d) => d.runnable).map(
  (d) => d.id,
)

/** Ids of drivers recorded-only until they ship (`['web', 'tui', 'library']`). */
export const awaitingDriverIds: readonly GuardAwaitingDriverId[] = GUARD_DRIVERS.filter(
  (d) => !d.runnable,
).map((d) => d.id as GuardAwaitingDriverId)

/** The zod enum over every driver id — reused by the manifest verdict + claim schemas. */
export const GuardDriverIdSchema = z.enum(guardDriverIds)

/** A driver's registry row by id (undefined for an unknown id). */
export function guardDriver(id: string): GuardDriverDef | undefined {
  return GUARD_DRIVERS.find((d) => d.id === id)
}

/** True when a driver's scenarios can be authored + run today. */
export function isRunnableDriver(id: GuardDriverId): boolean {
  return runnableDriverIds.includes(id)
}

/** Narrows a driver id to the awaiting (non-runnable) subset. */
export function isAwaitingDriver(id: GuardDriverId): id is GuardAwaitingDriverId {
  return !runnableDriverIds.includes(id)
}
