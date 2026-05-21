// Paraphrased FP shapes for code-quality/deterministic/unused-function-parameter.

// 1. Array iteration callback that ignores the trailing positional `index`.
//    `Array.prototype.map` provides the index parameter as part of its contract;
//    consumers commonly only need the element, and renaming `index` to `_index`
//    would falsely imply intent. Flagging this is a false positive.
type ListItem = { id: string; label: string };
const sourceItems: ListItem[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
];
export const decoratedItems = sourceItems.map((item, index) => ({
  ...item,
  highlighted: true,
}));

// 2. Arrow function whose only parameter is `$`-prefixed and IS used in the body.
//    The visitor's name-boundary check must treat `$` as part of the identifier;
//    otherwise it incorrectly reports the parameter as unused.
export function buildWatcherAttacher(): (node: HTMLElement) => string | undefined {
  let observedTarget: HTMLElement | null = null;
  return ($node: HTMLElement): string | undefined => {
    if ($node === observedTarget) return undefined;
    observedTarget = $node;
    return $node.tagName;
  };
}
