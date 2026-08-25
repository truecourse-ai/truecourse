/**
 * Paraphrased true-bug for bugs/deterministic/use-before-define.
 *
 * Module-scope const initialiser references another const declared further
 * down in the same module. Unlike the positive cases this is a value-position
 * reference, so it hits the temporal-dead-zone at runtime.
 */

// VIOLATION: bugs/deterministic/use-before-define
export const PRIMARY_BRAND_TONE = AVAILABLE_BRAND_TONES[0];

const AVAILABLE_BRAND_TONES = ['violet', 'amber', 'jade'] as const;
