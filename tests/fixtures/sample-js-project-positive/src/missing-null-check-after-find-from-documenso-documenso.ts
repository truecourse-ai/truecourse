/**
 * Paraphrased FP from documenso/documenso for
 * reliability/deterministic/missing-null-check-after-find.
 *
 * Konva's `Node.find('Group')` (CSS-selector style) returns `Node[]`,
 * not a single node. `Array.prototype.find` is what the rule is really
 * looking for; matching by method name alone fires on every other
 * `.find()` API (Konva, jQuery, Cheerio, etc.).
 *
 * Real example: packages/lib/universal/field-renderer/render-grid-lines.ts
 * at documenso/documenso@8f6be474.
 */

interface KonvaNode {
  readonly id: string;
  destroy(): void;
}

interface KonvaContainer {
  // Konva's selector-style `.find()` returns an array of matching nodes —
  // no possibility of undefined, so chained access is safe.
  find(selector: string): KonvaNode[];
}

export function clearGroups(stage: KonvaContainer): void {
  // Was flagged as "missing null check after .find()": the rule fired
  // because the result of `.find('Group')` is chained into `.forEach(...)`.
  stage.find('Group').forEach((node) => {
    node.destroy();
  });
}

export function countShapes(stage: KonvaContainer): number {
  // Was flagged: result of `.find(...)` chained into `.length` access.
  return stage.find('Shape').length;
}
