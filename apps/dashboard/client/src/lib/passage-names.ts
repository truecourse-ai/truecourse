/**
 * The names a reader tells the two sides of a contradiction INSIDE one doc
 * apart by. Both sides are the same doc, so each is named by the heading its
 * passage sits under (the lead when it has none), and by its order when both
 * sit under one heading. Side a is the first passage, side b the second.
 */
export function passageNames(anchorA: string | null, anchorB: string | null): [string, string] {
  const a = anchorA ?? 'lead';
  const b = anchorB ?? 'lead';
  return a === b ? [`${a}, first passage`, `${b}, second passage`] : [a, b];
}
