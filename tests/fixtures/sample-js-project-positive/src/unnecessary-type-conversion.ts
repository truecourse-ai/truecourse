/**
 * Positive fixture for code-quality/deterministic/unnecessary-type-conversion.
 *
 * Calling `Boolean(...)` on a logical-OR, logical-AND, or nullish-coalescing
 * chain is a common defensive idiom for coercing a possibly-truthy chain to an
 * exact `true | false`. The TypeScript checker frequently narrows the result
 * of such a chain to `boolean`, especially when one operand is already typed
 * as `boolean`, but the wrapper still communicates intent and protects against
 * future widening of any operand. The rule must not flag these forms.
 */

declare const isOwner: boolean;
declare const isMember: boolean;
declare const isPublic: boolean;
declare const isAdmin: boolean;

export const canManage = Boolean(isOwner || isMember);
export const canView = Boolean(isPublic && isMember);
export const canEdit = Boolean(isOwner ?? isAdmin);
