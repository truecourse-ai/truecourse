/**
 * Rest parameters and callback function-type annotations.
 *
 * These should NOT trigger `code-quality/deterministic/readonly-parameter-types`:
 *   - Rest parameters always bind a fresh local array, so the caller cannot
 *     observe any mutation through them.
 *   - Function-type annotations on object/interface properties describe a
 *     contract for callbacks; the parameter list is a type position, not an
 *     actual function being defined.
 */

interface ItemRecord {
  id: string;
  label: string;
}

export interface SelectionContract {
  onChange: (items: ItemRecord[]) => void;
  onPick: (ids: string[]) => void;
}

export type Listener = (events: ItemRecord[]) => void;

export function logAll(...args: unknown[]): void {
  for (const a of args) {
    if (a !== undefined) {
      JSON.stringify(a);
    }
  }
}

export function combine<T>(...lists: T[][]): T[] {
  const out: T[] = [];
  for (const list of lists) {
    for (const item of list) out.push(item);
  }
  return out;
}

export type Reducer<S, A> = (state: S, actions: A[]) => S;
