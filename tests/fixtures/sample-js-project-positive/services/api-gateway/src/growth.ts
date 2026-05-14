// Kysely window function with intentional `as any` cast — ORM builder API pattern.
declare const fn: {
  count(col: string): { as(alias: string): unknown };
  sum(expr: unknown): { over(ob: (ob: { orderBy(e: unknown): unknown }) => unknown): { as(alias: string): unknown } };
};
declare function sql(): { lit(v: unknown): unknown };

function buildGrowthQuery() {
  return [
    fn.count('id').as('count'),
    fn
      .sum(fn.count('id'))
      .over((ob) => ob.orderBy(fn as any))
      .as('cume_count'),
  ];
}
