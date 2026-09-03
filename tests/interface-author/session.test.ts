/**
 * THE SERVICE'S CONTRACT WITH ITS CALLERS — what the session def demands, and
 * what the module boundary hands out.
 *
 * Two things, and they are the same kind of thing: statements the rest of the
 * system compiles against. The def is what the loop reads (its budget, its
 * tools, and — 01 step 2k — the `check_draft` it will not accept an outcome
 * without); the export surface is what the CLI and the dashboard import, and it
 * moved house in 01 step 1 (`packages/interface-author` → `@truecourse/core`)
 * without being allowed to change.
 */

import { describe, it, expect } from 'vitest'
import {
  INTERFACE_AUTHOR_BUDGET,
  INTERFACE_AUTHOR_SESSION_KIND,
  interfaceAuthorSessionDef,
} from '../../packages/core/src/services/interface-author/session'

describe('the authoring session def', () => {
  const def = () =>
    interfaceAuthorSessionDef({
      repoRoot: '/nowhere',
      derived: null,
      authored: null,
      replaceable: new Set<string>(),
      scope: { screenId: 'root', address: '/' },
    })

  /**
   * ITEM 2k. Prompting alone did not carry "run `check_draft` early": the
   * measured median first call was turn 9 and eight sessions never called it.
   * The def states it structurally, so the shell refuses the first outcome of a
   * session that skipped it and says exactly this.
   */
  it('will not accept an outcome from a session that never ran `check_draft`', () => {
    expect(def().outcomePrecondition).toEqual({
      tool: 'check_draft',
      message:
        'Outcome refused: you never ran `check_draft` in this session. Call `check_draft` on your complete draft now — it runs the exact validation the write path will run, so a problem it finds costs one turn to fix here instead of the whole fragment at the outcome. Fix anything it reports, then call `outcome` again.',
    })
    // The tool it names is one the session actually has, or the demand is unmeetable.
    expect(def().tools.map((tool) => tool.name)).toContain(def().outcomePrecondition!.tool)
  })

  it('is the kind the sessions store files it under, on the three budget numbers', () => {
    expect(def().kind).toBe(INTERFACE_AUTHOR_SESSION_KIND)
    expect(INTERFACE_AUTHOR_SESSION_KIND).toBe('guard-interfaces.web-tasks')
    expect(def().budget).toEqual(INTERFACE_AUTHOR_BUDGET)
    expect(INTERFACE_AUTHOR_BUDGET).toEqual({ turns: 30, maxResumes: 1, tokenCeiling: 150_000 })
  })
})

/**
 * STEP 1. The service is a directory inside `@truecourse/core` now, reached by
 * one subpath export rather than a workspace package. The move is only inert if
 * everything the old package's index published is still published under the new
 * specifier — the CLI imports several of these by name.
 */
describe('the export surface the move had to preserve', () => {
  it('publishes the whole of the old index under `@truecourse/core/services/interface-author`', async () => {
    const surface = await import('@truecourse/core/services/interface-author')
    for (const name of [
      'INTERFACE_AUTHOR_BUDGET',
      'INTERFACE_AUTHOR_SESSION_KIND',
      'AUTHORED_SURFACE',
      'AuthoredFragmentSchema',
      'AuthoredPlaceSchema',
      'AuthoredTaskSchema',
      'MAX_PACK_BYTES',
      'MIN_JACCARD',
      'MIN_SHARED',
      'STATE_RECONCILE_STAGE',
      'STATE_RECONCILE_RESPONSE_SCHEMA',
      'StateMergeSchema',
      'StateReconcileResponseSchema',
      'appendInterfaceFindings',
      'authorWebInterfaces',
      'buildAuthorTools',
      'candidateAuthored',
      'clusterPack',
      'clusterPlaces',
      'defaultAuthorConcurrency',
      'interfaceAuthorSessionDef',
      'placeBriefing',
      'placeWorkItem',
      'planWorkItems',
      'pruneRacedTasks',
      'reconcileAuthoredStates',
      'reconcilePrompt',
      'reconcileStates',
      'registryStates',
      'stampFragment',
      'validateFragment',
      'writeAuthoredCatalog',
    ]) {
      expect(surface, name).toHaveProperty(name)
    }
    expect(typeof surface.authorWebInterfaces).toBe('function')
    expect(surface.INTERFACE_AUTHOR_SESSION_KIND).toBe('guard-interfaces.web-tasks')
  })

  it('leaves the command adapter exporting exactly what the CLI calls', async () => {
    const commands = await import('@truecourse/core/commands/guard-interfaces')
    expect(typeof commands.readGuardInterfacesAuthorView).toBe('function')
    expect(typeof commands.runGuardInterfaceAuthoring).toBe('function')
    expect(typeof commands.runGuardInterfaceReconcile).toBe('function')
  })
})
