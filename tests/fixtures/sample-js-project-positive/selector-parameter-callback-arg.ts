/**
 * Positive fixture for code-quality/deterministic/selector-parameter.
 *
 * A boolean parameter is only a "selector" when the author designed the
 * function's public signature. A callback passed as a call argument
 * (`promise.then(cb)`, `useCallback(cb)`) receives its parameter from the
 * consumer's contract, so its boolean parameter is not a flag the author can
 * refactor away by splitting the function in two.
 *
 * (The visitor applies the same carve-out to JSX prop callbacks such as
 * `onCollapseChange={(isCollapsed) => …}`; that shape is not exercised here
 * because an inline JSX callback independently trips inline-function-in-jsx-prop.)
 */

export function describeAvailability(check: Promise<boolean>): Promise<string> {
  return check.then((isUnique) => {
    if (isUnique) {
      return 'available';
    }
    return 'taken';
  });
}
