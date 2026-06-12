/**
 * Worker-side stepped-progress tracker — the EE analogue of the OSS
 * `StepTracker` (packages/core/src/progress.ts) that drives the analyze popup.
 *
 * A job task constructs one with its phase list and an async `emit`, then calls
 * `advance(key)` as each phase starts (earlier phases auto-complete), `detail()`
 * for an inline counter, and `finishAll()` / `fail()` at the terminal. Each
 * transition publishes a `{ current, total, message, steps }` snapshot, which the
 * worker forwards as a live SSE `job.progress` event (steps ride the event only —
 * they are never persisted on the `jobs` row).
 */

import type { JobStep } from '@truecourse/shared';

export interface StepSnapshot {
  current: number;
  total: number;
  message: string;
  steps: JobStep[];
}

export type StepEmit = (snap: StepSnapshot) => void | Promise<void>;

export class JobStepTracker {
  private readonly steps: JobStep[];

  constructor(defs: { key: string; label: string }[], private readonly emit: StepEmit) {
    this.steps = defs.map((d) => ({ key: d.key, label: d.label, status: 'pending' }));
  }

  /** Mark every step before `key` done and `key` active (monotonic). */
  async advance(key: string, detail?: string): Promise<void> {
    const idx = this.steps.findIndex((s) => s.key === key);
    if (idx < 0) return;
    this.steps.forEach((s, i) => {
      if (i < idx && s.status !== 'error') s.status = 'done';
    });
    const step = this.steps[idx];
    step.status = 'active';
    if (detail !== undefined) step.detail = detail;
    await this.emit(this.snapshot());
  }

  /** Update the active step's inline detail (e.g. a `3/12` counter). */
  async detail(key: string, detail: string): Promise<void> {
    const step = this.steps.find((s) => s.key === key);
    if (!step) return;
    step.detail = detail;
    await this.emit(this.snapshot());
  }

  /** Success terminal: mark every non-errored step done. */
  async finishAll(): Promise<void> {
    for (const s of this.steps) if (s.status !== 'error') s.status = 'done';
    await this.emit(this.snapshot());
  }

  /** Failure terminal: mark the in-flight (or next pending) step errored. */
  async fail(detail?: string): Promise<void> {
    const step =
      this.steps.find((s) => s.status === 'active') ??
      this.steps.find((s) => s.status === 'pending');
    if (step) {
      step.status = 'error';
      if (detail !== undefined) step.detail = detail;
    }
    await this.emit(this.snapshot());
  }

  snapshot(): StepSnapshot {
    const total = this.steps.length;
    const current = this.steps.filter((s) => s.status === 'done' || s.status === 'error').length;
    const active = this.steps.find((s) => s.status === 'active');
    const message = active
      ? active.detail
        ? `${active.label} (${active.detail})`
        : active.label
      : (this.steps[this.steps.length - 1]?.label ?? 'Working…');
    return { current, total, message, steps: this.steps.map((s) => ({ ...s })) };
  }
}
