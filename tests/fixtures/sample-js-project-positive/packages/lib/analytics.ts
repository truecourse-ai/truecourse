
// D22: Kysely groupBy with fn() callback — correct API, no type mismatch
declare const db: {
  selectFrom(table: string): QueryBuilder;
};

interface QueryBuilder {
  select(cols: string[]): QueryBuilder;
  groupBy(cb: (eb: ExpressionBuilder) => unknown): QueryBuilder;
  execute(): Promise<Record<string, unknown>[]>;
}

interface ExpressionBuilder {
  fn(name: string, args: unknown[]): unknown;
  ref(col: string): unknown;
}

export async function getSignerConversionStats(): Promise<Record<string, unknown>[]> {
  return db
    .selectFrom('SignerEvent')
    .select(['type', 'count'])
    .groupBy((eb) => eb.fn('DATE_TRUNC', [eb.ref('createdAt')]))
    .execute();
}



// D48: Kysely fn<Date>() generic type annotation on query result — no runtime mismatch
declare const sql: {
  lit(value: string): SqlFragment;
};

interface SqlFragment {
  _type: 'sql';
}

interface FnBuilder {
  <T>(name: string, args: (string | SqlFragment)[]): AliasableExpression<T>;
  count(col: string): AliasableExpression<number>;
  sum(expr: AliasableExpression<number>): WindowFnBuilder;
}

interface AliasableExpression<T> {
  as(alias: string): AliasedExpression<T>;
  over(cb: (ob: OverBuilder) => OverBuilder): AliasableExpression<T>;
}

interface AliasedExpression<T> {
  _type: 'aliased';
}

interface OverBuilder {
  orderBy(expr: AliasableExpression<unknown>): OverBuilder;
}

interface WindowFnBuilder {
  over(cb: (ob: OverBuilder) => OverBuilder): AliasableExpression<number>;
}

declare const db: {
  selectFrom(table: string): SelectBuilder;
};

interface SelectBuilder {
  select(cb: (args: { fn: FnBuilder }) => AliasedExpression<unknown>[]): SelectBuilder;
  where(cb: () => SqlFragment): SelectBuilder;
  groupBy(col: string): SelectBuilder;
  orderBy(col: string, dir: 'asc' | 'desc'): SelectBuilder;
  execute(): Promise<Array<{ month: Date; count: string; cume_count: string }>>;
}

export async function getMonthlyCompletedDocuments(): Promise<Array<{ month: Date; count: string; cume_count: string }>> {
  const qb = db
    .selectFrom('Document')
    .select(({ fn }) => [
      fn<Date>('DATE_TRUNC', [sql.lit('MONTH'), 'Document.updatedAt']).as('month'),
      fn.count('id').as('count'),
    ])
    .where(() => sql.lit('"Document"."status" = 'COMPLETED''))
    .groupBy('month')
    .orderBy('month', 'desc');

  return qb.execute();
}



// FP shape 2f494d3a3acf: Kysely fn() with any cast inside .over() — intentional cast to satisfy generics
declare const db: { selectFrom: (table: string) => { select: (...args: unknown[]) => { where: (...args: unknown[]) => { execute: () => Promise<unknown[]> } } } };
declare const fn: (...args: unknown[]) => unknown;

export async function getConversionByPeriod(period: string) {
  return db
    .selectFrom('conversions')
    .select(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn as any)('DATE_TRUNC', [period, 'created_at']).as('period'),
    )
    .where('status', '=', 'completed')
    .execute();
}



// --- argument-type-mismatch shape: intentional `as any` cast for query builder type limitation (window function orderBy) ---
declare const kyselyDb: { $kysely: { selectFrom: (table: string) => any } };
declare function sql<T>(strings: TemplateStringsArray, ...values: any[]): T;

async function getMonthlySignupCounts(): Promise<{ month: Date; count: bigint; cumulative: bigint }[]> {
  const qb = kyselyDb.$kysely
    .selectFrom('User')
    .select(({ fn }: any) => [
      fn<Date>('DATE_TRUNC', [sql`'MONTH'`, 'User.createdAt']).as('month'),
      fn.count('id').as('count'),
      fn
        .sum(fn.count('id'))
        // Kysely type limitation: window function orderBy cannot be typed safely with computed expressions
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
        .over((ob: any) => ob.orderBy(fn('DATE_TRUNC', [sql`'MONTH'`, 'User.createdAt']) as any))
        .as('cumulative'),
    ])
    .groupBy('month')
    .orderBy('month', 'desc');

  return qb.execute();
}
