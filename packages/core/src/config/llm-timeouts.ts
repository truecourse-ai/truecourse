/**
 * The clocks on a LEAF JUDGEMENT — a one-turn session with nothing to run and
 * nothing to look up, whose only way to take long is a provider stream that
 * went quiet. Two clocks, both wall-clock:
 *
 *   - the STALL timeout: no event from the driver for this long stops the
 *     session as stalled (`TRUECOURSE_LLM_STALL_TIMEOUT_MS`, default 5 min);
 *   - the session CEILING: the whole session, re-ask included, is bounded at
 *     {@link DEFAULT_ONE_TURN_TIMEOUT_MS}.
 *
 * `TRUECOURSE_LLM_TIMEOUT_SCALE` (a float, default 1) multiplies both, so one
 * knob widens everything on a slow provider. An unparsable or non-positive
 * value is the default.
 *
 * The pooled, tool-using sessions carry neither: a tool that runs a build for
 * minutes emits nothing while it runs, and their bound is turns and tokens.
 * They carry a TURN clock instead (`TRUECOURSE_LLM_TURN_TIMEOUT_MS`, default
 * 10 min): the model may go that long without finishing a turn or calling a
 * tool, and the clock pauses while a tool runs. A turn that thinks without end
 * otherwise runs to its output ceiling, which has taken 13 minutes.
 */

/** Default stall timeout when `TRUECOURSE_LLM_STALL_TIMEOUT_MS` is unset. */
export const DEFAULT_STALL_TIMEOUT_MS = 300_000;

/** The wall clock one leaf judgement gets, before the scale. */
export const DEFAULT_ONE_TURN_TIMEOUT_MS = 600_000;

/** Default turn timeout for a pooled session when `TRUECOURSE_LLM_TURN_TIMEOUT_MS` is unset. */
export const DEFAULT_TURN_TIMEOUT_MS = 600_000;

function positiveNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The multiplier on every LLM clock (`TRUECOURSE_LLM_TIMEOUT_SCALE`), 1 by default. */
export function resolveTimeoutScale(): number {
  return positiveNumber(process.env.TRUECOURSE_LLM_TIMEOUT_SCALE) ?? 1;
}

/** No event from the driver for this long is a stalled stream, scaled. */
export function resolveStallTimeoutMs(): number {
  return (positiveNumber(process.env.TRUECOURSE_LLM_STALL_TIMEOUT_MS) ?? DEFAULT_STALL_TIMEOUT_MS)
    * resolveTimeoutScale();
}

/** The wall clock a one-turn session gets, scaled. */
export function resolveOneTurnTimeoutMs(): number {
  return DEFAULT_ONE_TURN_TIMEOUT_MS * resolveTimeoutScale();
}

/** How long a pooled session's model may go without finishing a turn or calling a tool, scaled. */
export function resolveTurnTimeoutMs(): number {
  return (positiveNumber(process.env.TRUECOURSE_LLM_TURN_TIMEOUT_MS) ?? DEFAULT_TURN_TIMEOUT_MS) * resolveTimeoutScale();
}
