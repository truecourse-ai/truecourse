import type { ChildProcess } from 'node:child_process';

// ---------------------------------------------------------------------------
// Analysis Registry — tracks active analyses for cancellation support
// ---------------------------------------------------------------------------

interface ActiveAnalysis {
  analysisId: string;
  abortController: AbortController;
  childProcesses: Set<ChildProcess>;
}

const activeAnalyses = new Map<string, ActiveAnalysis>();

/** Register a new analysis. Aborts any existing analysis for the same repo. */
export function registerAnalysis(repoId: string, analysisId: string): AbortController {
  // Abort any existing analysis for this repo
  const existing = activeAnalyses.get(repoId);
  if (existing) {
    existing.abortController.abort();
    for (const child of existing.childProcesses) {
      if (!child.killed) child.kill('SIGTERM');
    }
  }

  const abortController = new AbortController();
  activeAnalyses.set(repoId, {
    analysisId,
    abortController,
    childProcesses: new Set(),
  });
  return abortController;
}

/** Register a child process for an active analysis (for cleanup on cancel). */
export function registerChildProcess(repoId: string, child: ChildProcess): void {
  const entry = activeAnalyses.get(repoId);
  if (entry) entry.childProcesses.add(child);
}

/** Unregister a child process when it exits naturally. */
export function unregisterChildProcess(repoId: string, child: ChildProcess): void {
  const entry = activeAnalyses.get(repoId);
  if (entry) entry.childProcesses.delete(child);
}

/** Cancel an active analysis. Returns true if an analysis was running. */
export function cancelAnalysis(repoId: string): boolean {
  const entry = activeAnalyses.get(repoId);
  if (!entry) return false;

  entry.abortController.abort();
  for (const child of entry.childProcesses) {
    if (!child.killed) child.kill('SIGTERM');
  }
  activeAnalyses.delete(repoId);
  return true;
}

/** Cleanup when analysis completes normally. */
export function unregisterAnalysis(repoId: string): void {
  activeAnalyses.delete(repoId);
}

/** Check if an analysis is active for a repo. */
export function isAnalysisActive(repoId: string): boolean {
  return activeAnalyses.has(repoId);
}
