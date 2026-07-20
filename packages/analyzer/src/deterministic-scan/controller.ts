import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import type { CodeViolation } from '@truecourse/shared'
import { initParsers } from '../parser.js'
import { runDeterministicScan } from './run-scan.js'
import type { DeterministicScanInput, WorkerToMainMessage } from './types.js'

/** A file skipped because it exceeded the per-file budget. */
export interface SkippedFile {
  filePath: string
  reason: string
}

export interface DeterministicScanResult {
  violations: CodeViolation[]
  /** Files skipped by the watchdog (empty on a clean run). */
  skipped: SkippedFile[]
}

export interface ScanControllerOptions {
  /** Per-file wall-clock budget. A file exceeding it is terminated and skipped. */
  fileTimeoutMs: number
  /** Cooperative cancellation (e.g. Ctrl+C). */
  signal?: AbortSignal
  /** Progress reporter — `processed` counts files finished OR skipped, out of `total`. */
  onProgress?(processed: number, total: number): void
  /** Called once per skipped file so the caller can warn. */
  onSkip?(filePath: string, reason: string): void
  /**
   * Override the worker entry path. Normally resolved automatically for the
   * current packaging layout; provided for tests and advanced embedders.
   */
  workerPath?: string
}

/** Input for the controller — `startIndex` is managed internally across resume passes. */
export type IsolatedScanInput = Omit<DeterministicScanInput, 'startIndex'>

/**
 * Locate the worker entry for the current packaging layout:
 *  - unbundled (tsc output, dev/tests): `worker.js` sits next to this module.
 *  - bundled (esbuild `cli.mjs`/`server.mjs`): this module is inlined into the
 *    entry bundle, and scripts/build.ts emits the worker as a sibling
 *    `det-scan-worker.mjs`. `import.meta.url` then points at the bundle dir.
 * Returns null when neither exists (the caller falls back to in-thread).
 */
function resolveWorkerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [path.join(here, 'worker.js'), path.join(here, 'det-scan-worker.mjs')]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

type PassOutcome =
  | { kind: 'complete' }
  | { kind: 'stall'; stalledIndex: number }
  | { kind: 'error'; message: string }
  | { kind: 'aborted' }

/**
 * Run one worker pass from `input.startIndex`, resolving when the worker
 * completes, stalls on a single file, errors, or the run is aborted. The worker
 * is always terminated before this resolves.
 */
function runOneWorkerPass(
  workerPath: string,
  input: DeterministicScanInput,
  opts: ScanControllerOptions,
  onResult: (index: number, violations: CodeViolation[]) => void,
): Promise<PassOutcome> {
  return new Promise<PassOutcome>((resolve) => {
    const worker = new Worker(workerPath, { workerData: input })
    let settled = false
    let inFlightIndex = input.startIndex
    let watchdog: ReturnType<typeof setTimeout> | undefined

    const finish = (outcome: PassOutcome) => {
      if (settled) return
      settled = true
      if (watchdog) clearTimeout(watchdog)
      opts.signal?.removeEventListener('abort', onAbort)
      void worker.terminate()
      resolve(outcome)
    }

    // The watchdog only runs while a file is in flight. It is (re)armed on every
    // message, so a file that stops producing messages for `fileTimeoutMs` is
    // deemed stalled. The main thread is otherwise idle, so this timer fires
    // reliably even while the worker is pinned in synchronous backtracking.
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog)
      watchdog = setTimeout(() => finish({ kind: 'stall', stalledIndex: inFlightIndex }), opts.fileTimeoutMs)
      watchdog.unref?.()
    }

    const onAbort = () => finish({ kind: 'aborted' })
    if (opts.signal) {
      if (opts.signal.aborted) {
        finish({ kind: 'aborted' })
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    worker.on('message', (msg: WorkerToMainMessage) => {
      if (settled) return
      switch (msg.type) {
        case 'file-start':
          inFlightIndex = msg.index
          armWatchdog()
          break
        case 'file-result':
          onResult(msg.index, msg.violations)
          armWatchdog()
          break
        case 'complete':
          finish({ kind: 'complete' })
          break
        case 'error':
          finish({ kind: 'error', message: msg.message })
          break
      }
    })
    worker.on('error', (err) => finish({ kind: 'error', message: err.message }))
    worker.on('exit', (code) => {
      // A clean exit after 'complete'/'stall' is already settled; anything else
      // is an unexpected early death.
      if (!settled) finish({ kind: 'error', message: `worker exited early (code ${code})` })
    })
  })
}

/** In-thread fallback used only when the worker entry can't be resolved. */
async function runInThread(
  input: IsolatedScanInput,
  opts: ScanControllerOptions,
): Promise<DeterministicScanResult> {
  const total = input.files.length
  const violations: CodeViolation[] = []
  let processed = 0
  await initParsers()
  await runDeterministicScan(
    { ...input, startIndex: 0 },
    {
      onFileResult: (_index, _filePath, v) => {
        violations.push(...v)
        processed++
        opts.onProgress?.(processed, total)
      },
      shouldStop: () => opts.signal?.aborted ?? false,
    },
  )
  if (opts.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError')
  return { violations, skipped: [] }
}

/**
 * Run the deterministic per-file scan in a killable worker, enforcing a per-file
 * timeout so a single pathological file (e.g. catastrophic regex backtracking)
 * is skipped-with-a-warning instead of freezing the whole run. On a stall the
 * worker is terminated and a fresh one resumes after the offending file.
 *
 * Falls back to an in-thread scan when no worker entry can be found — the run
 * still completes; it just loses the per-file hang guarantee.
 */
export async function runDeterministicScanIsolated(
  input: IsolatedScanInput,
  opts: ScanControllerOptions,
): Promise<DeterministicScanResult> {
  const workerPath = opts.workerPath ?? resolveWorkerPath()
  if (!workerPath) return runInThread(input, opts)

  const total = input.files.length
  const violations: CodeViolation[] = []
  const skipped: SkippedFile[] = []
  let nextIndex = 0
  let processed = 0

  while (nextIndex < total) {
    const outcome = await runOneWorkerPass(
      workerPath,
      { ...input, startIndex: nextIndex },
      opts,
      (_index, v) => {
        violations.push(...v)
        processed++
        opts.onProgress?.(processed, total)
      },
    )

    if (outcome.kind === 'complete') break
    if (outcome.kind === 'aborted') throw new DOMException('Analysis cancelled', 'AbortError')
    if (outcome.kind === 'error') {
      throw new Error(`deterministic scan worker failed: ${outcome.message}`)
    }

    // Stall: skip the in-flight file and resume the scan just past it.
    const bad = input.files[outcome.stalledIndex]
    const reason = `exceeded the ${opts.fileTimeoutMs}ms per-file budget (possible catastrophic regex backtracking)`
    skipped.push({ filePath: bad.filePath, reason })
    opts.onSkip?.(bad.filePath, reason)
    processed++
    opts.onProgress?.(processed, total)
    nextIndex = outcome.stalledIndex + 1
  }

  return { violations, skipped }
}
