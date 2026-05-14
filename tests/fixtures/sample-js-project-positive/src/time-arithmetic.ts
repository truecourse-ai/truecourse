/**
 * Time arithmetic patterns that should NOT trigger magic-number.
 *
 * The magic-number rule skips time conversion factors
 * when they appear in a multiplication chain with at least one other time factor.
 * Named constants with SCREAMING_SNAKE names are also skipped.
 */

const TIMEOUT_MS = 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function getTimeoutMs(): number {
  return TIMEOUT_MS;
}

export function getWeekMs(): number {
  return WEEK_MS;
}

export function getHalfHourMs(): number {
  return HALF_HOUR_MS;
}

export function getOneDayMs(): number {
  return ONE_DAY_MS;
}

export function getFiveMinutesMs(): number {
  return FIVE_MINUTES_MS;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function isExpired(timestamp: number): boolean {
  return Date.now() - timestamp > ONE_DAY_MS;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / MS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  return `${hours}h ${minutes % MINUTES_PER_HOUR}m ${seconds % SECONDS_PER_MINUTE}s`;
}



// Shape 63ec9b337628: DateTime.fromJSDate(date).toRelative() in cell; date is Date, fromJSDate accepts Date.
interface DateTimeObj { toRelative(): string | null }
declare const DateTime: { fromJSDate(date: Date): DateTimeObj };
interface CredentialRow { createdAt: Date; label: string }

function formatRelativeDate(row: CredentialRow): string {
  return DateTime.fromJSDate(row.createdAt).toRelative() ?? 'just now';
}



// --- FP shape: ORM Date field passed to date library constructor ---
declare const DateTime: { fromJSDate(date: Date): { toISO(): string } };
declare const record: { createdAt: Date; updatedAt: Date };

const createdIso = DateTime.fromJSDate(record.createdAt).toISO();
const updatedIso = DateTime.fromJSDate(record.updatedAt).toISO();



// --- argument-type-mismatch shape b373432c66bb ---
// Kysely fn<Date>() generic types a result column as Date;
// passing that column to a date-parsing function is not a type mismatch.

declare const reportDb: {
  selectFrom(table: string): ReportQueryBuilder;
};

interface ReportQueryBuilder {
  select(cb: (h: { fn: KyselyFnHelper }) => unknown[]): ReportQueryBuilder;
  where(cb: () => unknown): ReportQueryBuilder;
  groupBy(col: string): ReportQueryBuilder;
  orderBy(col: string, dir: string): ReportQueryBuilder;
  execute(): Promise<Array<{ period: Date; total: string; cumulative: string }>>;
}

interface KyselyFnHelper {
  <T>(name: string, args: unknown[]): { as(alias: string): unknown; over(cb: (ob: any) => any): { as(alias: string): unknown } };
  count(col: string): { as(alias: string): unknown };
  sum(val: unknown): { over(cb: (ob: any) => any): { as(alias: string): unknown } };
}

declare const CalendarDate: {
  fromJSDate(date: Date): { toFormat(pattern: string): string };
};

async function buildMonthlyJobReport(mode: "count" | "cumulative") {
  const qb = reportDb
    .selectFrom("ScheduledJob")
    .select(({ fn }) => [
      fn<Date>("DATE_TRUNC", ["MONTH", "ScheduledJob.finishedAt"]).as("period"),
      fn.count("id").as("total"),
      fn
        .sum(fn.count("id"))
        .over((ob: any) => ob.orderBy(fn("DATE_TRUNC", ["MONTH", "ScheduledJob.finishedAt"])))
        .as("cumulative"),
    ])
    .groupBy("period")
    .orderBy("period", "desc");

  const rows = await qb.execute();

  return {
    labels: rows.map((row) => CalendarDate.fromJSDate(row.period).toFormat("MMM yyyy")).reverse(),
    values: rows.map((row) => (mode === "count" ? Number(row.total) : Number(row.cumulative))).reverse(),
  };
}



// cb53c0189cc6: wrapping a raw date string in new Date() then passing to DateTime.fromJSDate()
declare const DateTime: { fromJSDate(d: Date): { toISO(): string } };

function parseRawTimestamp(rawDate: string): string {
  const dt = DateTime.fromJSDate(new Date(rawDate));
  return dt.toISO();
}



// Single certificate component uses a date format string; one usage only
declare function formatDate(date: Date, fmt: string): string;

export function formatCertificateDate(date: Date): string {
  return formatDate(date, 'yyyy-MM-dd hh:mm:ss a (ZZZZ)');
}



// Lookup table with arithmetic expressions for duration constants
const SESSION_TIMEOUTS = {
  shortSession: 15 * 60 * 1000,
  standardSession: 60 * 60 * 1000,
  extendedSession: 24 * 60 * 60 * 1000,
  rememberMe: 30 * 24 * 60 * 60 * 1000,
};

function getSessionTimeout(type: keyof typeof SESSION_TIMEOUTS) {
  return SESSION_TIMEOUTS[type];
}



// UTC offset formatting — converts raw minute offsets (e.g. -330, 330) to ±HH:MM strings.
export function formatUtcOffset(offsetMinutes: number): string {
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const sign = offsetMinutes >= 0 ? '+' : '-';
  return `UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Returns the hour component of a duration expressed in total minutes.
export function minutesToWholeHours(totalMinutes: number): number {
  return Math.floor(totalMinutes / 60);
}



// Assigns a visitor to one of two experiment buckets (50/50 coin flip).
export function assignExperimentBucket(sessionId: string): 'control' | 'treatment' {
  void sessionId;
  return Math.random() > 0.5 ? 'control' : 'treatment';
}



// Webhook sample data generation with expired token example
function generateExpiredTokenData(): object {
  const now = new Date();
  return {
    token: 'sample-expired-token',
    // Expired 1 minute ago
    expiresAt: new Date(now.getTime() - 60 * 1000).toISOString(),
    createdAt: now.toISOString(),
  };
}



// --- magic-string FP shape: typed-discriminant-union (date format string in library call) ---
declare function formatDate(date: Date, fmt: string): string;

function renderCertificateDate(date: Date): string {
  return formatDate(date, 'yyyy-MM-dd hh:mm:ss a (ZZZZ)');
}
