/**
 * The per-flow authoring board `guard generate` paints under its checklist:
 * a partition counter that always sums, plus one row per active worker.
 *
 *   flows  settled 41 · active 6 · queued 52 · blocked 7 — of 106
 *     ⚙ add-and-complete-a-task · cli · 34s
 *     ⚙ resume-a-spec-scan · cli · 12s
 *
 * States are exclusive per (flow, surface) task — the generator emits queued
 * up front, active at session start, and exactly one terminal — so the counter
 * sums to the task total by construction. Time-derived content (elapsed
 * seconds) is computed at render, so the renderer's spinner cadence keeps it
 * current.
 */

import type { FlowAuthoringState } from '@truecourse/guard-generator';

const MAX_ACTIVE_ROWS = 6;

interface TaskView {
  flowId: string;
  surface: string;
  state: FlowAuthoringState;
  detail?: string;
  /** Set when the state became `active` — drives the elapsed column. */
  activeSince?: number;
}

export interface FlowBoard {
  onFlowState: (flowId: string, surface: string, state: FlowAuthoringState, detail?: string) => void;
  /** The footer lines for the live region; empty before any task is known. */
  render: () => string[];
}

export function createFlowBoard(now: () => number = Date.now): FlowBoard {
  const tasks = new Map<string, TaskView>();

  return {
    onFlowState(flowId, surface, state, detail) {
      const key = `${flowId}\0${surface}`;
      const prev = tasks.get(key);
      tasks.set(key, {
        flowId,
        surface,
        state,
        ...(detail !== undefined ? { detail } : {}),
        ...(state === 'active'
          ? { activeSince: prev?.activeSince ?? now() }
          : {}),
      });
    },
    render() {
      if (tasks.size === 0) return [];
      const counts: Record<FlowAuthoringState, number> = {
        queued: 0,
        active: 0,
        settled: 0,
        blocked: 0,
        retired: 0,
        error: 0,
      };
      const active: TaskView[] = [];
      for (const task of tasks.values()) {
        counts[task.state] += 1;
        if (task.state === 'active') active.push(task);
      }
      const parts = [
        `settled ${counts.settled}`,
        `active ${counts.active}`,
        `queued ${counts.queued}`,
        `blocked ${counts.blocked}`,
        ...(counts.retired > 0 ? [`retired ${counts.retired}`] : []),
        ...(counts.error > 0 ? [`errors ${counts.error}`] : []),
      ];
      const lines = [`  flows  ${parts.join(' · ')} — of ${tasks.size}`];
      active.sort((a, b) => (a.activeSince ?? 0) - (b.activeSince ?? 0));
      for (const task of active.slice(0, MAX_ACTIVE_ROWS)) {
        const elapsed = task.activeSince ? Math.round((now() - task.activeSince) / 1000) : 0;
        lines.push(`    ⚙ ${task.flowId} · ${task.surface} · ${elapsed}s`);
      }
      if (active.length > MAX_ACTIVE_ROWS) {
        lines.push(`    … ${active.length - MAX_ACTIVE_ROWS} more running`);
      }
      return lines;
    },
  };
}
