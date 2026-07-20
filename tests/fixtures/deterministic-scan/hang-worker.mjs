// Test double for the deterministic-scan worker. Speaks the real message
// protocol but lets us deterministically simulate a pathological file: any file
// whose path contains "HANG" busy-loops forever, so the controller's per-file
// watchdog must terminate this worker and resume past it.
import { parentPort, workerData } from 'node:worker_threads'

const { files, startIndex } = workerData

for (let i = startIndex; i < files.length; i++) {
  const f = files[i]
  parentPort.postMessage({ type: 'file-start', index: i, filePath: f.filePath })
  if (f.filePath.includes('HANG')) {
    // Faithful reproduction of the real bug: drive V8's regex engine into
    // catastrophic (exponential) backtracking so this thread is pinned in
    // native regex code — exactly the failure mode from issue #814. The
    // controller's watchdog + worker.terminate() must still kill it.
    const evil = /(a+)+$/
    evil.test('a'.repeat(50) + '!') // never returns in any realistic time
  }
  parentPort.postMessage({
    type: 'file-result',
    index: i,
    violations: [{ marker: f.filePath }],
  })
}
parentPort.postMessage({ type: 'complete' })
