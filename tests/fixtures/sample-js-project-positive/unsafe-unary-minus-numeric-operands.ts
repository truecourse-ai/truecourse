// Unary minus is safe on any operand whose type is `number` or `bigint`
// (including literal-number/bigint types and method results that return one).
// The rule should accept all of the shapes below.

export function fractionalOffset(direction: 'forward' | 'backward'): number {
  return direction === 'forward' ? 1.5 : -1.5;
}

export function localUtcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export const LOWER_BIGINT_BOUND: bigint = -9223372036854775808n;
export const UPPER_BIGINT_BOUND: bigint = 9223372036854775808n;

interface RingState {
  readonly capacity: number;
  entries: ReadonlyArray<string>;
}

export function trimHistoryRing(state: RingState): ReadonlyArray<string> {
  if (state.entries.length <= state.capacity) return state.entries;
  return state.entries.slice(-state.capacity);
}

interface TailOptions {
  readonly lines: number;
}

export function tailLogLines(
  buffer: ReadonlyArray<string>,
  options: TailOptions,
): string {
  return buffer.slice(-options.lines).join('\n');
}
