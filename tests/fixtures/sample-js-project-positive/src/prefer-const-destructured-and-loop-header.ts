/**
 * Three shapes that the rule should not flag:
 *
 * 1. Destructured `let` declarations (`let { width, height } = …`)
 *    where individual bindings may be reassigned later via array /
 *    object destructured assignment. The visitor's name-based check
 *    can't reliably distinguish, and rewriting to `const` is broken
 *    if any single binding is reassigned.
 * 2. Simple `let` bindings reassigned via destructured assignment
 *    (`[a, b] = await Promise.all([...])`) — the LHS is a pattern,
 *    not the bare identifier, so a text-equality check misses it.
 * 3. `let` declared inside a `for` statement header — even when
 *    individual declarators aren't reassigned, the `let i, max`
 *    loop-locals convention is idiomatic.
 */

declare function getPageSize(): { width: number; height: number };
declare const isRotated: boolean;
declare const corpusLength: number;

export function swapDims(): readonly [number, number] {
  let { width, height } = getPageSize();
  if (isRotated) [width, height] = [height, width];
  return [width, height];
}

export async function loadPair(): Promise<readonly [string | null, string | null]> {
  let first: string | null = null;
  let second: string | null = null;
  [first, second] = await Promise.all([Promise.resolve('a'), Promise.resolve('b')]);
  return [first, second];
}

export function lastIndex(): number {
  let chosen = -1;
  for (let i = 0, max = corpusLength - 1; i < max; i++) {
    chosen = i;
  }
  return chosen;
}
