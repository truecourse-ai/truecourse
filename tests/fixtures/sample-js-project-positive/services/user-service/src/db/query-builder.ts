export class QueryBuilder {
  private readonly table: string;
  private readonly conditions: string[] = [];
  constructor(table: string) { this.table = table; }
  where(column: string, value: string): this {
    this.conditions.push(`${column} = ${value}`);
    return this;
  }
  toSQL(): string {
    let sql = `SELECT id, name, email FROM ${this.table}`;
    if (this.conditions.length > 0) {
      sql = `${sql} WHERE ${this.conditions.join(' AND ')}`;
    }
    return sql;
  }
}
export function buildInsertQuery(table: string, columns: readonly string[]): string {
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (...)`;
}



// ORM query builder with aggregation functions accepting column references
declare const queryBuilder: {
  selectFrom(table: string): {
    select(cb: (helpers: { fn: any }) => any[]): any;
  };
};

declare const sql: {
  lit(value: string): any;
};

export async function getMonthlySessionStats() {
  const report = queryBuilder
    .selectFrom('Session')
    .select(({ fn }) => [
      fn<Date>('DATE_TRUNC', [sql.lit('MONTH'), 'Session.createdAt']).as('month'),
      fn.count('sessionId').as('total'),
      fn
        .avg(fn.count('sessionId'))
        .over((ob) => ob.orderBy(fn('DATE_TRUNC', [sql.lit('MONTH'), 'Session.createdAt'])))
        .as('rollingAverage'),
    ]);
  
  return report;
}

export async function getDailyActivityMetrics() {
  const metrics = queryBuilder
    .selectFrom('Activity')
    .select(({ fn }) => [
      fn('DATE', [sql.lit('DAY'), 'Activity.timestamp']).as('day'),
      fn.sum('Activity.duration').as('totalDuration'),
    ]);
  
  return metrics;
}



// Query builder with typed callback API for SQL aggregate functions
declare const db: {
  selectFrom(table: string): TypedQueryBuilder;
};

interface SqlFunctionBuilder {
  <T>(name: string, args: any[]): SqlExpression<T>;
  count(column: string): SqlExpression<number> & { distinct(): SqlExpression<number> };
  sum<T>(expr: SqlExpression<T>): SqlExpression<T> & {
    over(fn: (ob: OrderByBuilder) => OrderByBuilder): SqlExpression<T>;
  };
}

interface SqlExpression<T> {
  as(alias: string): AliasedExpression<T>;
}

interface AliasedExpression<T> {}

interface OrderByBuilder {
  orderBy(expr: any): OrderByBuilder;
}

interface TypedQueryBuilder {
  select(fn: (helpers: { fn: SqlFunctionBuilder }) => AliasedExpression<any>[]): TypedQueryBuilder;
  where(predicate: () => any): TypedQueryBuilder;
  groupBy(fn: (helpers: { fn: SqlFunctionBuilder }) => any): TypedQueryBuilder;
  orderBy(column: string, direction: 'asc' | 'desc'): TypedQueryBuilder;
  limit(count: number): TypedQueryBuilder;
  execute(): Promise<any[]>;
}

declare const sql: {
  lit(value: any): any;
};

export async function getMonthlyActivityStats() {
  const queryBuilder = db
    .selectFrom('ActivityLog')
    .select(({ fn }) => [
      fn<Date>('DATE_TRUNC', [sql.lit('MONTH'), 'ActivityLog.timestamp']).as('month'),
      fn.count('userId').distinct().as('activeUsers'),
      fn
        .sum(fn.count('userId').distinct())
        .over((ob) => ob.orderBy(fn('DATE_TRUNC', [sql.lit('MONTH'), 'ActivityLog.timestamp'])))
        .as('cumulativeUsers'),
    ])
    .where(() => sql`status = 'active'`)
    .groupBy(({ fn }) => fn('DATE_TRUNC', [sql.lit('MONTH'), 'ActivityLog.timestamp']))
    .orderBy('month', 'desc')
    .limit(12);

  return await queryBuilder.execute();
}

export async function getUserEngagementMetrics() {
  const result = db
    .selectFrom('UserEvents')
    .select(({ fn }) => [
      fn<string>('DATE_PART', [sql.lit('YEAR'), 'UserEvents.createdAt']).as('year'),
      fn.count('eventId').as('totalEvents'),
    ])
    .groupBy(({ fn }) => fn('DATE_PART', [sql.lit('YEAR'), 'UserEvents.createdAt']))
    .orderBy('year', 'asc');

  return await result.execute();
}


// --- argument-type-mismatch FP: fn.count<number>('id') in Kysely query builder ---
// fn.count<number>('id').as('total') is a valid Kysely generic count call; no type mismatch.
declare const kyselyReports: {
  $kysely: {
    selectFrom(source: unknown): {
      select(cb: (helpers: { fn: { count<T>(col: string): { as(alias: string): unknown } } }) => unknown): {
        executeTakeFirstOrThrow(): Promise<{ total: number | bigint | null }>;
      };
    };
  };
};
declare const filteredReportQuery: { as(alias: string): unknown };

export async function countFilteredReports(): Promise<number> {
  const countQuery = kyselyReports.$kysely
    .selectFrom(filteredReportQuery.as('filtered'))
    .select(({ fn }) => fn.count<number>('id').as('total'));

  const result = await countQuery.executeTakeFirstOrThrow();
  return Number(result.total ?? 0);
}

