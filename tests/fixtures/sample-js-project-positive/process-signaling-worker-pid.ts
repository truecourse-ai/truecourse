/**
 * Positive fixture for security/deterministic/process-signaling.
 *
 * The PID passed to process.kill() is `worker.process.pid` — the process id
 * of a worker this program itself forked. A spawned child/worker's
 * `.process.pid` is owned by the parent, never attacker-controlled, so
 * forwarding a signal to it is safe. Flagging it as "sending signals to
 * arbitrary processes" is a false positive.
 */

interface WorkerHandle {
  process: { pid: number | undefined }
}

export function forwardSignalToWorkers(workers: readonly WorkerHandle[], signal: string): void {
  for (const worker of workers) {
    if (worker.process.pid) {
      process.kill(worker.process.pid, signal)
    }
  }
}
