/**
 * stateful-regex shape that should NOT fire:
 *
 * A `/g` regex stored in a module-scope constant is only
 * "stateful" when used with `.test()` / `.exec()` (which mutate
 * `lastIndex`). Consumed via `.replace()` / `.match()` /
 * `.matchAll()` / `.findText()` (pdf-lib) is stateless — those
 * use the source pattern but reset internally per call.
 */

declare const page: { findText: (re: RegExp) => Array<{ index: number }> };

const PLACEHOLDER_REGEX = /\{\{[a-z_][a-z0-9_]*\}\}/giu;

export function findPlaceholders(): Array<{ index: number }> {
  return page.findText(PLACEHOLDER_REGEX);
}

export function fillPlaceholders(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER_REGEX, (match) => {
    const key = match.slice(2, -2);
    return values[key] ?? "";
  });
}
