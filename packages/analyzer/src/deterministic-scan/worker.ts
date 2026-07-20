import { parentPort, workerData } from 'node:worker_threads'
import { initParsers } from '../parser.js'
import { runDeterministicScan } from './run-scan.js'
import type { DeterministicScanInput, WorkerToMainMessage } from './types.js'

/**
 * Worker-thread entry for the deterministic per-file scan.
 *
 * Running the scan here — rather than on the main thread — is what lets the
 * controller enforce a per-file timeout: a file that drives a visitor into
 * catastrophic regex backtracking blocks THIS thread, but the main thread stays
 * free to notice the stall and `terminate()` the worker. See ./controller.ts.
 */
async function main(): Promise<void> {
  if (!parentPort) throw new Error('deterministic-scan worker must be spawned as a worker thread')
  const port = parentPort
  const input = workerData as DeterministicScanInput

  const post = (msg: WorkerToMainMessage) => port.postMessage(msg)

  try {
    await initParsers()
    await runDeterministicScan(input, {
      onFileStart: (index, filePath) => post({ type: 'file-start', index, filePath }),
      onFileResult: (index, _filePath, violations) => post({ type: 'file-result', index, violations }),
    })
    post({ type: 'complete' })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

void main()
