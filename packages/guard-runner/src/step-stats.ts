/**
 * No-op anomaly detection (C4) — the last line of defense against a silently
 * inert recipe: a do-nothing entry (or a dead stub server) runs every scenario as
 * an instant, indistinguishable step, which produces bogus passes and bogus birth
 * findings at scale. Each driver aggregates a compact per-step observation into
 * per-run stats; `detectNoOpAnomaly` judges the aggregate. A real `guard run`
 * surfaces the anomaly on its ok result (never aborts); `guard generate` ABORTS
 * on it before anything is written.
 *
 * The predicate is PER DRIVER, because "suspiciously inert" means different
 * observables on each surface — and both are purely structural (emptiness,
 * uniformity, timing), never string matching:
 *
 *  - cli — a step that spawned, exited 0, wrote NOTHING to either stream, and
 *    returned under {@link NO_OP_STEP_THRESHOLD_MS} did nothing observable. A
 *    large sample made overwhelmingly of those is a do-nothing binary (it
 *    ignores its arguments).
 *
 *  - api — timing deliberately does NOT enter the predicate: a healthy loopback
 *    server legitimately answers in single-digit milliseconds, so latency cannot
 *    separate a dead stub from a fast healthy API. What can: a dead stub answers
 *    EVERY request the same way with NOTHING — the HTTP analogue of "instant and
 *    silent" is an EMPTY response body at ONE uniform status regardless of route
 *    or method. The anomaly therefore requires all three: an overwhelming
 *    empty-body fraction, exactly one distinct status across every completed
 *    request, and at least {@link ANOMALY_MIN_DISTINCT_REQUEST_LINES} distinct
 *    `METHOD path` request lines (so a single hammered endpoint that honestly
 *    answers 204-empty can never trip it).
 */

// ---------------------------------------------------------------------------
// Observations — one per executed step invocation, emitted by the drivers
// ---------------------------------------------------------------------------

/**
 * A compact observation of ONE executed cli step invocation (each `repeat`
 * iteration is one) — the raw-capture fields the runner aggregates for anomaly
 * detection. Emitted for every step that SPAWNED (a spawn failure is not an
 * executed step); a timed-out step counts (it ran) but is never a no-op.
 */
export interface StepObservation {
  exitCode: number | null
  /** The raw stdout was empty (before normalization). */
  stdoutEmpty: boolean
  /** The raw stderr was empty (before normalization). */
  stderrEmpty: boolean
  durationMs: number
}

/**
 * A compact observation of ONE executed api request step invocation. Emitted for
 * every request that COMPLETED or TIMED OUT (a request that never reached the
 * server — connection refused, DNS — observed nothing, mirroring a cli spawn
 * failure); a timed-out request counts (it ran) but is never inert.
 */
export interface ApiStepObservation {
  /** HTTP status, or null when the request timed out. */
  status: number | null
  /** The raw response body was empty. */
  bodyEmpty: boolean
  timedOut: boolean
  /**
   * `METHOD path` as the SCENARIO DECLARES it (pre-interpolation), so twenty
   * `${unique}`-interpolated requests to one route never read as route variety.
   */
  requestLine: string
  durationMs: number
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** A cli step this fast, with exit 0 and no output at all, did nothing observable. */
export const NO_OP_STEP_THRESHOLD_MS = 10
/** Below this many executed steps (per driver) the sample is too small to call. */
export const ANOMALY_MIN_EXECUTED_STEPS = 20
/** At or above this no-op/inert fraction the sample is overwhelmingly dead. */
export const ANOMALY_NOOP_FRACTION = 0.9
/** The api uniformity claim ("every route answers identically") needs at least
 *  this many distinct `METHOD path` request lines to be about routes at all. */
export const ANOMALY_MIN_DISTINCT_REQUEST_LINES = 2

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/** The cli half of a run's step aggregate. */
export interface GuardCliStepStats {
  /** Executed step invocations across all scenarios (each `repeat` iteration counts). */
  executedSteps: number
  /** Of those, the ones that were exit 0, empty stdout, empty stderr, and instant. */
  noOpSteps: number
  /** The no-op wall-clock threshold this aggregate used. */
  thresholdMs: number
}

/** The api half of a run's step aggregate. */
export interface GuardApiStepStats {
  /** Executed request invocations (completed or timed out) across all scenarios. */
  executedRequests: number
  /** Of those, the completed ones whose response body was EMPTY. */
  inertRequests: number
  /** Distinct HTTP statuses across every COMPLETED request, ascending. */
  statuses: number[]
  /** Distinct declared `METHOD path` request lines across completed requests, sorted. */
  requestLines: string[]
}

/** Per-run step aggregate, per driver. Kept in memory only (the `LATEST.json`
 *  schema is frozen); birth validation folds it across rounds. */
export interface GuardRunStepStats {
  cli: GuardCliStepStats
  api: GuardApiStepStats
}

/** A zeroed aggregate under the given (or default) cli no-op threshold. */
export function emptyStepStats(noOpThresholdMs?: number): GuardRunStepStats {
  return {
    cli: { executedSteps: 0, noOpSteps: 0, thresholdMs: noOpThresholdMs ?? NO_OP_STEP_THRESHOLD_MS },
    api: { executedRequests: 0, inertRequests: 0, statuses: [], requestLines: [] },
  }
}

/** Fold two aggregates (birth rounds accumulate): counts add, sets union. */
export function foldStepStats(a: GuardRunStepStats, b: GuardRunStepStats): GuardRunStepStats {
  return {
    cli: {
      executedSteps: a.cli.executedSteps + b.cli.executedSteps,
      noOpSteps: a.cli.noOpSteps + b.cli.noOpSteps,
      thresholdMs: b.cli.thresholdMs || a.cli.thresholdMs,
    },
    api: {
      executedRequests: a.api.executedRequests + b.api.executedRequests,
      inertRequests: a.api.inertRequests + b.api.inertRequests,
      statuses: [...new Set([...a.api.statuses, ...b.api.statuses])].sort((x, y) => x - y),
      requestLines: [...new Set([...a.api.requestLines, ...b.api.requestLines])].sort(),
    },
  }
}

/** True when a cli step spawned, exited 0, wrote nothing, and returned under the threshold. */
export function isNoOpStep(obs: StepObservation, thresholdMs: number): boolean {
  return obs.exitCode === 0 && obs.stdoutEmpty && obs.stderrEmpty && obs.durationMs < thresholdMs
}

/** True when an api request completed and answered with an EMPTY body. */
export function isInertRequest(obs: ApiStepObservation): boolean {
  return !obs.timedOut && obs.status !== null && obs.bodyEmpty
}

/** The live collector a run feeds — one per `runGuard` invocation. */
export interface StepStatsCollector {
  onCliStep(obs: StepObservation): void
  onApiStep(obs: ApiStepObservation): void
  snapshot(): GuardRunStepStats
}

export function createStepStatsCollector(noOpThresholdMs?: number): StepStatsCollector {
  const thresholdMs = noOpThresholdMs ?? NO_OP_STEP_THRESHOLD_MS
  const cli: GuardCliStepStats = { executedSteps: 0, noOpSteps: 0, thresholdMs }
  let executedRequests = 0
  let inertRequests = 0
  const statuses = new Set<number>()
  const requestLines = new Set<string>()
  return {
    onCliStep(obs) {
      cli.executedSteps += 1
      if (isNoOpStep(obs, thresholdMs)) cli.noOpSteps += 1
    },
    onApiStep(obs) {
      executedRequests += 1
      if (isInertRequest(obs)) inertRequests += 1
      if (obs.status !== null) {
        statuses.add(obs.status)
        requestLines.add(obs.requestLine)
      }
    },
    snapshot() {
      return {
        cli: { ...cli },
        api: {
          executedRequests,
          inertRequests,
          statuses: [...statuses].sort((x, y) => x - y),
          requestLines: [...requestLines].sort(),
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// The anomaly verdict
// ---------------------------------------------------------------------------

/** The detected anomaly — the driver whose sample tripped, with its counts. */
export type GuardNoOpAnomaly =
  | {
      driver: 'cli'
      executedSteps: number
      noOpSteps: number
      /** `noOpSteps / executedSteps`. */
      fraction: number
      thresholdMs: number
    }
  | {
      driver: 'api'
      executedRequests: number
      inertRequests: number
      /** `inertRequests / executedRequests`. */
      fraction: number
      /** The single status every completed request answered. */
      status: number
      /** How many distinct `METHOD path` request lines the uniform sample spans. */
      requestLines: number
    }

/**
 * Judge an aggregate, per driver. Each driver's anomaly needs a large-enough
 * sample (>= {@link ANOMALY_MIN_EXECUTED_STEPS}) AND an overwhelming dead
 * fraction (>= {@link ANOMALY_NOOP_FRACTION}); the api verdict additionally
 * requires status UNIFORMITY across route/method VARIETY (see the module doc).
 * Returns the first tripped driver's counts, or null when nothing looks dead.
 */
export function detectNoOpAnomaly(stats: GuardRunStepStats): GuardNoOpAnomaly | null {
  const { cli, api } = stats
  if (cli.executedSteps >= ANOMALY_MIN_EXECUTED_STEPS) {
    const fraction = cli.noOpSteps / cli.executedSteps
    if (fraction >= ANOMALY_NOOP_FRACTION) {
      return {
        driver: 'cli',
        executedSteps: cli.executedSteps,
        noOpSteps: cli.noOpSteps,
        fraction,
        thresholdMs: cli.thresholdMs,
      }
    }
  }
  if (
    api.executedRequests >= ANOMALY_MIN_EXECUTED_STEPS &&
    api.statuses.length === 1 &&
    api.requestLines.length >= ANOMALY_MIN_DISTINCT_REQUEST_LINES
  ) {
    const fraction = api.inertRequests / api.executedRequests
    if (fraction >= ANOMALY_NOOP_FRACTION) {
      return {
        driver: 'api',
        executedRequests: api.executedRequests,
        inertRequests: api.inertRequests,
        fraction,
        status: api.statuses[0],
        requestLines: api.requestLines.length,
      }
    }
  }
  return null
}
