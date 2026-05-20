/**
 * `sql<T>\`…\`` is a Drizzle/Kysely-style tagged template literal with an
 * explicit generic. tree-sitter-typescript misparses it as
 * `(sql < T) > \`…\``, so the `binary_expression` visitor of
 * `values-not-convertible-to-number` sees a phantom relational
 * comparison. That misparse must not be flagged.
 */

export type SqlFragment<T> = { __brand: 'sql'; placeholderCount: number; sample: T };

export function sql<T>(strings: ReadonlyArray<string>, ...values: ReadonlyArray<T>): SqlFragment<T> {
  return { __brand: 'sql', placeholderCount: strings.length + values.length, sample: values[0] };
}

export function buildAuditConditionAll(): SqlFragment<boolean> {
  return sql<boolean>`1=1`;
}

export function buildAuditConditionRange(startDate: Date, endDate: Date): SqlFragment<boolean> {
  return sql<boolean>`audit."createdAt" >= ${startDate} AND audit."createdAt" <= ${endDate}`;
}
