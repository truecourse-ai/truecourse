/**
 * magic-string shapes that should NOT fire:
 *
 * String literals that appear as arguments to SQL query-builder
 * methods (Kysely / Knex / Drizzle / Prisma `$kysely`). These
 * are SQL identifiers — table names, column names, function
 * names — required by the builder API. Extracting them to
 * named constants would either lose the literal-type narrowing
 * (Kysely uses string literals to type column refs) or just
 * shift the same string into a `const` without changing call
 * sites.
 */

declare const kyselyPrisma: {
  $kysely: {
    selectFrom: (table: string) => SelectQueryBuilder;
  };
};
declare const sql: {
  lit: (value: string) => SqlExpression;
};

interface SqlExpression {
  toString(): string;
}

interface SelectQueryBuilder {
  select(args: (helpers: { fn: SqlFn }) => unknown[]): SelectQueryBuilder;
  innerJoin(table: string, leftCol: string, rightCol: string): SelectQueryBuilder;
  where(cb: () => SqlExpression): SelectQueryBuilder;
  groupBy(col: string): SelectQueryBuilder;
  orderBy(col: string, dir: "asc" | "desc"): SelectQueryBuilder;
  execute(): Promise<ReadonlyArray<{ month: Date; count: number }>>;
}

interface SqlFn {
  count(col: string): SqlExpression;
  <T>(name: string, args: ReadonlyArray<SqlExpression | string>): { as(alias: string): SqlExpression };
}

export async function getCompletedDocumentsMonthly(): Promise<unknown> {
  const qb = kyselyPrisma.$kysely
    .selectFrom("Envelope")
    .select(({ fn }) => [
      fn<Date>("DATE_TRUNC", [sql.lit("MONTH"), "Envelope.updatedAt"]).as("month"),
      fn.count("id"),
    ])
    .innerJoin("Recipient", "Recipient.envelopeId", "Envelope.id")
    .where(() => sql.lit("MONTH"))
    .groupBy("month")
    .orderBy("month", "desc");

  return qb.execute();
}
