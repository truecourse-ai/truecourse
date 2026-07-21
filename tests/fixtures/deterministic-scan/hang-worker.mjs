// Test double for the deterministic-scan worker. Speaks the real message
// protocol but lets us deterministically simulate pathological behavior:
//   - a file whose path contains "HANG" busy-loops in a catastrophic regex
//     while processing that file → the per-file watchdog must kill + resume.
//   - a run containing a file path with "HANG_SETUP" busy-loops during the
//     setup phase (before `setup-done`) → the setup watchdog must catch it.
import { parentPort, workerData } from 'node:worker_threads'

const { files, startIndex } = workerData

// Faithful reproduction of the real bug: drive V8's regex engine into
// catastrophic (exponential) backtracking, pinning this thread in native regex
// code — exactly the failure mode from issue #814.
function pinThread() {
  const evil = /(a+)+$/
  evil.test('a'.repeat(50) + '!') // never returns in any realistic time
}

// Setup-phase hang: happens before any message is sent, so only the setup
// watchdog can catch it.
if (files.some((f) => f.filePath.includes('HANG_SETUP'))) pinThread()

parentPort.postMessage({ type: 'setup-done' })

for (let i = startIndex; i < files.length; i++) {
  const f = files[i]
  parentPort.postMessage({ type: 'file-start', index: i, filePath: f.filePath })
  if (f.filePath.includes('HANG')) pinThread()
  parentPort.postMessage({ type: 'file-result', index: i, violations: [{ marker: f.filePath }] })
}
parentPort.postMessage({ type: 'complete' })
