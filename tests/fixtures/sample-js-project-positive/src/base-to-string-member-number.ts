/**
 * Positive fixture for bugs/deterministic/base-to-string.
 *
 * The FP: `obj.numericField.toString()` where the receiver is a
 * `number`. The rule was resolving the type of the leading identifier
 * (`obj`) instead of the full member expression (`obj.numericField`),
 * so the receiver looked like a plain object (`{ ... }`) even though
 * `.toString()` is actually being called on a primitive.
 */

interface ParsedDuration {
  readonly value: number;
  readonly unit: string;
}

declare function parseDuration(period: string): ParsedDuration | null;

export function formatDuration(period: string): { value: string; unit: string } {
  const parsed = parseDuration(period);
  if (parsed) {
    return { value: parsed.value.toString(), unit: parsed.unit };
  }
  return { value: '', unit: 'm' };
}
