/**
 * The names a reader tells the two sides of a contradiction INSIDE one doc
 * apart by. Both sides are the same doc, so each is named by the heading its
 * sentence sits under (the lead when it has none), and by its order when both
 * sit under one heading. Side a is the first sentence, side b the second.
 */
export function sentenceNames(anchorA: string | null, anchorB: string | null): [string, string] {
  const a = anchorA ?? 'lead';
  const b = anchorB ?? 'lead';
  return a === b ? [`${a}, first sentence`, `${b}, second sentence`] : [a, b];
}
