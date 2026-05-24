/**
 * Positive fixture for code-quality/deterministic/type-import-side-effects.
 *
 * The rule should only fire when a module's import has ONLY inline-type
 * specifiers (e.g. `import { type Foo } from 'x'`), because the module
 * would still be loaded but no value is consumed. When the import also
 * pulls a runtime value — a default import, a namespace import, or a
 * regular value specifier — the module loads anyway and the inline
 * `type` keyword on individual specifiers is the recommended form.
 *
 * The default-import-plus-inline-type shape (e.g.
 * `import Papa, { type ParseResult } from 'papaparse'`) should not
 * trigger the rule.
 */

import CsvParser, { type ParseRows } from 'csv-parser-stub';

export function parseRows<T>(input: string): ParseRows<T> {
  return CsvParser.parse(input) as ParseRows<T>;
}
