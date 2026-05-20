/**
 * Positive fixture for bugs/deterministic/use-before-define.
 *
 * Two FP shapes:
 *
 *   1. The source-name half of an aliased import (`import { X as Y }`)
 *      shares its identifier text with a const declared later in the same
 *      module. The source name is not a reference to anything in this
 *      module — it's the symbol being imported — so it cannot trip TDZ.
 *
 *   2. `typeof X` in a type position resolves at type-check time, not at
 *      runtime. Even when X is declared textually later in the module,
 *      there is no TDZ hazard because the type system erases it.
 */

import type { Status as StatusEnum } from './use-before-define-helpers';

// (2) Type alias references `AVAILABLE_TONES` (declared at the bottom of the
//     file) inside a `typeof` type query. Erased at runtime.
export type TBrandTone = (typeof AVAILABLE_TONES)[number];

export type TStatusValue = (typeof StatusEnum)[keyof typeof StatusEnum];

// (2) Function type derived via `typeof` of a later-declared function.
export type ResolvedToken = ReturnType<typeof loadTokenById>;

// (1) Local const that re-exports the imported enum under a friendlier name.
// Its identifier `Status` matches the source name of the `import { Status as
// StatusEnum }` above. The rule must not treat the import-side `Status` as a
// reference to this binding.
export const Status = StatusEnum;

function loadTokenById(id: string): { id: string; tone: TBrandTone } {
  return { id, tone: AVAILABLE_TONES[0] };
}

export function fetchToken(id: string): ResolvedToken {
  return loadTokenById(id);
}

const AVAILABLE_TONES = ['warm', 'cool', 'earthy'] as const;
