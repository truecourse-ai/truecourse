
// Shape: ORM builder fn.sum(fn.count(...).distinct()) — valid nested aggregate
declare const db: {
  $kysely: {
    selectFrom(table: string): {
      innerJoin(table: string, col1: string, col2: string): unknown;
      select(fn: (args: { fn: { count(col: string): { distinct(): { as(alias: string): unknown }; as(alias: string): unknown }; sum(v: unknown): { over(fn: (ob: { orderBy(col: unknown): unknown }) => unknown): { as(alias: string): unknown } } } }) => unknown[]): unknown;
      where(col: string, op: string, val: unknown): unknown;
      groupBy(fn: (args: { fn(name: string, args: unknown[]): unknown }) => unknown): unknown;
      orderBy(col: string, dir: string): { execute(): Promise<{ month: Date; count: string; cumulative: string }[]> };
    };
  };
};

async function getMonthlyConversionStats() {
  const qb = db.$kysely
    .selectFrom('Subscriber')
    .innerJoin('Account', 'Subscriber.email', 'Account.email')
    .select(({ fn }) => [
      fn.count('Subscriber.email').distinct().as('count'),
      fn
        .sum(fn.count('Subscriber.email').distinct())
        .over((ob) => ob.orderBy(fn('DATE_TRUNC', ['MONTH', 'Account.createdAt'])))
        .as('cumulative'),
    ]);

  return qb;
}



// sql.lit('MONTH') — SQL date truncation with a standard granularity literal
declare const sql: { lit: (s: string) => unknown };
declare const kyselyDb: { selectFrom: (table: string) => any };

function getMonthlyActiveUsers() {
  return kyselyDb
    .selectFrom('AuditLog')
    .select(({ fn }: any) => [
      fn<Date>('DATE_TRUNC', [sql.lit('MONTH'), 'AuditLog.createdAt']).as('month'),
      fn.count('userId').distinct().as('count'),
    ]);
}



// .select() array with qualified column names — Kysely column selection pattern
declare const db: { selectFrom: (table: string) => any };

function queryPendingEnvelopes() {
  return db
    .selectFrom('Envelope')
    .select(['Envelope.id', 'Envelope.secondaryId'])
    .where('Envelope.status', '=', 'PENDING');
}



// sql.lit('MONTH') and column name string in fn() — Kysely date truncation with column identifier
declare const sql: { lit: (s: string) => unknown };
declare const kyselyDb: { selectFrom: (table: string) => any };

function getCompletedDocumentsPerMonth() {
  return kyselyDb
    .selectFrom('Envelope')
    .select(({ fn }: any) => [
      fn<Date>('DATE_TRUNC', [sql.lit('MONTH'), 'Envelope.updatedAt']).as('month'),
      fn.count('id').as('count'),
    ])
    .groupBy('month')
    .orderBy('month', 'desc');
}
