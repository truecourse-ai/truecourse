/**
 * unsafe-type-assertion shape that should NOT fire:
 *
 * `arr.filter(Boolean) as T[]` — TypeScript's narrowing
 * doesn't drop nullable from the element type when the
 * filter predicate is the bare `Boolean` constructor. The
 * `as T[]` is the canonical workaround until the inferred
 * predicate type lands; flagging it produces noise at every
 * use of the idiom.
 */

interface Item {
  readonly id: string;
  readonly label: string;
}

declare const items: ReadonlyArray<Item | null | undefined>;

export function nonNullItems(): ReadonlyArray<Item> {
  return items.filter(Boolean) as ReadonlyArray<Item>;
}

export function nonNullIds(): ReadonlyArray<string> {
  return items
    .map((i) => i?.id)
    .filter(Boolean) as ReadonlyArray<string>;
}
