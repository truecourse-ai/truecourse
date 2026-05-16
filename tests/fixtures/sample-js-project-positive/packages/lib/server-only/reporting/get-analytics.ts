
// FP: sql<boolean>`e."createdAt" >= ${date}` — sql<T> is a tagged template that produces
// a type-parameterized SQL fragment, not a JS boolean. The value is never converted to number.
declare function sql<T>(strings: TemplateStringsArray, ...values: unknown[]): T;
declare const kyselyPrisma: { $kysely: { selectFrom: (table: string) => unknown } };

async function getRecentRecordCount(sinceDate: Date) {
  let dateFilter = sql<boolean>`1=1`;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  dateFilter = sql<boolean>`r."createdAt" >= ${thirtyDaysAgo}`;

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  dateFilter = sql<boolean>`r."createdAt" >= ${ninetyDaysAgo} AND r."createdAt" <= ${sinceDate}`;

  return dateFilter;
}



// FP: sql<boolean>`e."completedAt" >= ${date}` — Kysely tagged template SQL fragment.
// sql<T> produces an opaque SQL expression, not a JS value convertible to number.
declare function sql2<T>(strings: TemplateStringsArray, ...values: unknown[]): T;

async function getCompletedRecordFilter(endDate: Date) {
  let filter = sql2<boolean>`1=1`;

  const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - 1, endDate.getDate());
  filter = sql2<boolean>`r."completedAt" >= ${startDate} AND r."completedAt" <= ${endDate}`;

  return filter;
}



// FP: sql<boolean>`1=1` then overwritten — Kysely tagged template; never a JS numeric value.
declare function sqlFragment<T>(strings: TemplateStringsArray, ...values: unknown[]): T;
declare const db: { from: (table: string) => unknown };

function buildDateFilter(dateRange: 'today' | 'week' | 'month' | 'all') {
  let condition = sqlFragment<boolean>`1=1`;

  switch (dateRange) {
    case 'today': {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      condition = sqlFragment<boolean>`r."createdAt" >= ${today}`;
      break;
    }
    case 'week': {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      condition = sqlFragment<boolean>`r."createdAt" >= ${weekAgo}`;
      break;
    }
    case 'month': {
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      condition = sqlFragment<boolean>`r."createdAt" >= ${monthAgo}`;
      break;
    }
    default:
      break;
  }

  return condition;
}



// FP: sql<boolean>`r."updatedAt" >= ${date}` — Kysely SQL tagged template fragment.
// The <boolean> type parameter is a TS annotation for query building, not a JS boolean.
declare function rawSql<T>(strings: TemplateStringsArray, ...values: unknown[]): T;

function buildUpdatedFilter(sinceDate: Date, untilDate?: Date) {
  if (untilDate) {
    return rawSql<boolean>`r."updatedAt" >= ${sinceDate} AND r."updatedAt" <= ${untilDate}`;
  }
  return rawSql<boolean>`r."updatedAt" >= ${sinceDate}`;
}



// FP: let dateCondition = sql<boolean>`1=1` — initial no-op SQL condition.
// sql<T> is a tagged template literal for building type-safe SQL; 1=1 is always-true SQL.
declare function kyselySql<T>(strings: TemplateStringsArray, ...values: unknown[]): T;

async function buildReport(opts: { startDate?: Date; endDate?: Date }) {
  let dateCondition = kyselySql<boolean>`1=1`;

  if (opts.startDate && opts.endDate) {
    dateCondition = kyselySql<boolean>`r."createdAt" >= ${opts.startDate} AND r."createdAt" <= ${opts.endDate}`;
  }

  return dateCondition;
}
