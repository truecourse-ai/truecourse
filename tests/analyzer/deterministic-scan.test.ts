import { describe, it, expect } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runDeterministicScanIsolated, type IsolatedScanInput } from '../../packages/analyzer/src/deterministic-scan/controller'

const HANG_WORKER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/deterministic-scan/hang-worker.mjs',
)

function fileList(names: string[]): IsolatedScanInput['files'] {
  // absPath is unused by the test worker; keep it plausible.
  return names.map((n) => ({ filePath: n, absPath: `/virtual/${n}` }))
}

function baseInput(names: string[]): IsolatedScanInput {
  return {
    repoPath: '/virtual',
    files: fileList(names),
    enabledRuleKeys: [],
    tsFiles: [],
    databaseResult: undefined,
  }
}

describe('runDeterministicScanIsolated (controller)', () => {
  it('collects every file’s results on a clean run', async () => {
    const names = ['a.ts', 'b.ts', 'c.ts']
    const progress: Array<[number, number]> = []
    const result = await runDeterministicScanIsolated(baseInput(names), {
      fileTimeoutMs: 5_000,
      workerPath: HANG_WORKER,
      onProgress: (p, t) => progress.push([p, t]),
    })

    expect(result.skipped).toEqual([])
    expect(result.violations.map((v: any) => v.marker)).toEqual(names)
    // Progress reaches the total.
    expect(progress.at(-1)).toEqual([3, 3])
  })

  it('skips a stalled file with a warning and resumes past it', async () => {
    const names = ['a.ts', 'b.ts', 'HANG.ts', 'c.ts', 'd.ts']
    const skips: string[] = []
    const result = await runDeterministicScanIsolated(baseInput(names), {
      fileTimeoutMs: 300, // short budget so the busy-loop trips it quickly
      workerPath: HANG_WORKER,
      onSkip: (fp) => skips.push(fp),
    })

    // The hung file is skipped...
    expect(skips).toEqual(['HANG.ts'])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].filePath).toBe('HANG.ts')
    expect(result.skipped[0].reason).toContain('per-file')
    // ...and every other file is still scanned (resume worked).
    expect(result.violations.map((v: any) => v.marker)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
  }, 15_000)

  it('handles multiple stalled files', async () => {
    const names = ['HANG1.ts', 'a.ts', 'HANG2.ts', 'b.ts']
    const result = await runDeterministicScanIsolated(baseInput(names), {
      fileTimeoutMs: 250,
      workerPath: HANG_WORKER,
    })
    expect(result.skipped.map((s) => s.filePath)).toEqual(['HANG1.ts', 'HANG2.ts'])
    expect(result.violations.map((v: any) => v.marker)).toEqual(['a.ts', 'b.ts'])
  }, 20_000)

  it('bounds a setup-phase hang with the setup watchdog', async () => {
    // The worker pins the thread during setup (before `setup-done`), so only the
    // setup watchdog — not the per-file one — can catch it. A generous per-file
    // budget ensures it's the setup timer that fires.
    const promise = runDeterministicScanIsolated(baseInput(['HANG_SETUP.ts']), {
      fileTimeoutMs: 60_000,
      setupTimeoutMs: 300,
      workerPath: HANG_WORKER,
    })
    await expect(promise).rejects.toThrow(/setup/i)
  }, 15_000)

  it('rejects with an AbortError when the signal fires mid-scan', async () => {
    const controller = new AbortController()
    const names = ['HANG.ts'] // worker will pin on the first file
    const promise = runDeterministicScanIsolated(baseInput(names), {
      fileTimeoutMs: 60_000, // long, so the abort wins the race, not the watchdog
      workerPath: HANG_WORKER,
      signal: controller.signal,
    })
    // Let the worker start and pin, then abort.
    setTimeout(() => controller.abort(), 200)
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  }, 15_000)

  it('falls back to in-thread when no worker can be resolved', async () => {
    // A bogus workerPath is ignored (falsey check is on resolve, not existence),
    // so force the fallback by pointing resolution at a non-existent bundled
    // layout: pass an empty override and rely on resolveWorkerPath returning null
    // under vitest (source layout has no sibling worker.js / det-scan-worker.mjs).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'det-scan-'))
    const filePath = path.join(dir, 'empty-catch.ts')
    fs.writeFileSync(filePath, 'try { doSomething(); } catch (e) {}\n')

    const result = await runDeterministicScanIsolated(
      {
        repoPath: dir,
        files: [{ filePath, absPath: filePath }],
        enabledRuleKeys: ['bugs/deterministic/empty-catch'],
        tsFiles: [],
        databaseResult: undefined,
      },
      { fileTimeoutMs: 5_000 }, // no workerPath → resolveWorkerPath() returns null under source layout → in-thread
    )

    fs.rmSync(dir, { recursive: true, force: true })
    expect(result.skipped).toEqual([])
    expect(result.violations.some((v: any) => v.ruleKey === 'bugs/deterministic/empty-catch')).toBe(true)
  })
})
