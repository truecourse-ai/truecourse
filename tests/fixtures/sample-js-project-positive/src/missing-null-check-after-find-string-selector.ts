/**
 * Positive fixture for reliability/deterministic/missing-null-check-after-find.
 *
 * Selector-style `.find(stringSelector)` APIs (Konva, jQuery, Cheerio,
 * Playwright locators, etc.) commonly return a non-array collection-like
 * type whose return string does NOT match `T[]` or `Array<T>`. When type
 * resolution is unavailable (e.g. analyzing without node_modules) the
 * return is `any`, so the array-shape skip never triggers. In both cases
 * the rule was firing on what was clearly a selector call — the first
 * argument is a string literal, which `Array.prototype.find` (whose only
 * argument is a predicate callback) cannot accept.
 *
 * Also covers the multi-line optional-chain shape:
 *   `arr.find(cb)\n  ?.prop` — the `?.` is on the next physical line.
 * The previous text-based check required `?.` to immediately follow the
 * call with no whitespace in between, so wrapped chains were flagged.
 */

interface CanvasNode {
  readonly id: string;
  destroy(): void;
  size(): number;
}

interface CanvasNodeCollection {
  // Selector-style: returns another collection. NOT an array — the
  // returned string type does not match `T[]` / `Array<T>`.
  find(selector: string): CanvasNodeCollection;
  filter(pred: (n: CanvasNode) => boolean): CanvasNodeCollection;
  forEach(cb: (n: CanvasNode) => void): void;
  sort(cmp: (a: CanvasNode, b: CanvasNode) => number): CanvasNodeCollection;
  readonly length: number;
}

export function clearGroups(stage: CanvasNodeCollection): void {
  // Was flagged: `.find('Group')` chained into `.forEach(...)` — but the
  // string-literal first argument means this can't be Array.prototype.find.
  stage.find('Group').forEach((node) => {
    node.destroy();
  });
}

export function countShapes(stage: CanvasNodeCollection): number {
  // Was flagged: `.find('Shape').length` — same reasoning, string selector.
  return stage.find('Shape').length;
}

export function sortedChildren(stage: CanvasNodeCollection): CanvasNodeCollection {
  // Chained `.find('...').sort(...)` — still a selector call.
  return stage.find('.tile').sort((a, b) => a.id.localeCompare(b.id));
}

export function filteredHandles(stage: CanvasNodeCollection): CanvasNodeCollection {
  // Chained `.find('...').filter(...)` — still a selector call.
  return stage.find('.handle').filter((node) => node.size() > 0);
}

interface Entry {
  readonly id: number;
  readonly tags: ReadonlyArray<{ readonly kind: string }>;
}

export function firstTagFor(
  entries: ReadonlyArray<Entry>,
  entryId: number,
): { readonly kind: string } | undefined {
  // Optional-chain split across a line break. The result of `Array.find`
  // (which CAN be undefined) is safely accessed via `?.tags.find(...)`.
  // The rule must recognise the `?.` even when whitespace/newlines sit
  // between the call's closing `)` and the `?.`.
  return entries
    .find((entry) => entry.id === entryId)
    ?.tags.find((tag) => tag.kind === 'primary');
}
