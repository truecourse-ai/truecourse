/**
 * Two magic-number FP shapes:
 *
 * 1. Byte-size powers (1024, 1024*1024) — well-known KB/MB
 *    constants identical to the existing time-factor handling.
 * 2. Validator chain methods (`.min(N)`, `.max(N)`, etc.) —
 *    the number IS the schema constraint, not magic.
 *
 * Positive fixture: NO magic-number violations should fire.
 */

declare const z: {
  string: () => {
    min: (n: number) => unknown;
    max: (n: number) => unknown;
    length: (n: number) => unknown;
  };
  number: () => {
    gte: (n: number) => unknown;
    lte: (n: number) => unknown;
    int: () => unknown;
  };
};

// Validator chain: numbers are schema constraints
export const passkeyName = z.string().min(3).max(64);
export const otherSchema = z.string().min(3).max(64).length(64);
export const ageBound = z.number().gte(13).lte(120);

// Byte-size constants in formatter
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
