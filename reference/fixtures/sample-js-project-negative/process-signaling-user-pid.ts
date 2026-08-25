/**
 * Negative fixture for security/deterministic/process-signaling.
 *
 * The PID comes straight from an inbound request, so an attacker can name any
 * process on the host and have it signalled. Sending SIGKILL to an
 * attacker-chosen PID is the real process-manipulation bug this rule catches.
 */

export function terminateReportedProcess(request: { pid: string }): void {
  const targetPid = Number.parseInt(request.pid, 10)
  // VIOLATION: security/deterministic/process-signaling
  process.kill(targetPid, 'SIGKILL')
}
