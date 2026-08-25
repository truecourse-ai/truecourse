/**
 * Shared fixtures for the `guard adjudicate` tests (plan 05, steps 21–22): a
 * throwaway repo, a board with failing rows, a manifest carrying a flow
 * worker's declared red, and the `AdjudicationItem` shape the pre-pass, the
 * cache key, the briefing and the fold all read.
 *
 * Deliberately minimal — every test states the facts it is about and inherits
 * nothing it does not name.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  GuardExpectedRed,
  GuardLatest,
  GuardManifest,
  GuardScenario,
  GuardScenarioResult,
} from '@truecourse/shared'
import type { AdjudicationItem } from '../../packages/core/src/services/guard-adjudicate/pre-pass'

export const RUN_ID = '2026-08-19T00-00-00_run1'

/** A throwaway repo root with a `package.json`. */
export function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-adjudicate-'))
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'tmp-adjudicate-repo', version: '0.0.0' }),
  )
  return dir
}

export function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

/** One board row — a `fail` at `step` unless overridden. */
export function failRow(
  id: string,
  over: Partial<GuardScenarioResult> = {},
): GuardScenarioResult {
  return {
    id,
    title: `${id} title`,
    binds: { doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' },
    outcome: 'fail',
    durationMs: 5,
    failure: { step: 3, expected: 'exit 0', actual: 'exit 2 — unknown flag' },
    ...over,
  }
}

/** A board envelope over `scenarios`, with the tallies its rows imply. */
export function board(scenarios: GuardScenarioResult[], runId = RUN_ID): GuardLatest {
  const summary = { total: scenarios.length, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0, blocked: 0 }
  for (const s of scenarios) summary[s.outcome]++
  return {
    run: {
      runId,
      ranAt: '2026-08-19T00:00:00.000Z',
      branch: 'main',
      commit: 'deadbeefcafef00d',
      recipeFingerprint: 'sha256:r',
    },
    summary,
    scenarios,
    sections: [],
  }
}

/** A manifest whose single flow carries one scenario and its diagnosis. */
export function manifestWith(
  entries: readonly { scenarioId: string; flowId: string; expectedRed?: GuardExpectedRed }[],
): GuardManifest {
  return {
    flows: entries.map((e) => ({
      flowId: e.flowId,
      flowFingerprint: `fp-${e.flowId}`,
      bindings: [],
      scenarios: [
        {
          id: e.scenarioId,
          drivers: ['cli'] as const,
          status: 'failing' as const,
          ...(e.expectedRed
            ? {
                diagnosis: {
                  doc: 'docs/spec.md',
                  anchor: 'a/b',
                  title: `${e.scenarioId} title`,
                  step: e.expectedRed.step,
                  expected: 'exit 0',
                  actual: e.expectedRed.predictedActual,
                  file: `${e.flowId}/x.yaml`,
                  expectedRed: e.expectedRed,
                },
              }
            : {}),
        },
      ],
      interfaces: [],
      generationInputsHash: null,
      gaps: [],
    })),
  } as GuardManifest
}

/** A committed cli scenario — the shape `rerun_scoped` / the cache key read. */
export function scenarioDoc(id: string, over: Partial<GuardScenario> = {}): GuardScenario {
  return {
    id,
    title: `${id} title`,
    binds: [{ doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' }],
    steps: [{ run: ['--version'], expect: { exit: 0 } }],
    normalize: [],
    ...over,
  } as GuardScenario
}

/** Write `content` at a repo-relative path, creating parents. */
export function writeFile(repo: string, rel: string, content: string): void {
  const target = path.join(repo, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/** The work item the pre-pass, the key and the fold all read. */
export function item(over: Partial<AdjudicationItem> = {}): AdjudicationItem {
  const row = over.row ?? failRow('scn.a')
  return {
    scenarioId: row.id,
    title: row.title,
    outcome: 'fail',
    runId: RUN_ID,
    row,
    step: row.failure?.step ?? 1,
    expected: row.failure?.expected ?? '',
    actual: row.failure?.actual ?? '',
    surface: 'cli',
    ...over,
  }
}
