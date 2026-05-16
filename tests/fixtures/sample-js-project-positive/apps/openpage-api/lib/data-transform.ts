
// Pass-through: catch(error) passes error directly to console.error, returns fallback
async function transformApiResponse(rawData: unknown): Promise<ProcessedData | null> {
  try {
    return parseAndTransform(rawData);
  } catch (error) {
    console.error(error);
    return null;
  }
}

interface ProcessedData { items: string[]; total: number; }
declare function parseAndTransform(data: unknown): ProcessedData;


// argument-type-mismatch FP: Kysely window function with intentional `as any` cast
// to work around orderBy type limitation in cumulative sum window
declare const fn: {
  count(col: string): { as(alias: string): unknown };
  sum(expr: unknown): { over(ob: (ob: { orderBy(e: unknown): unknown }) => unknown): { as(alias: string): unknown } };
};

function buildMonthlyGrowthSelect() {
  return [
    fn.count('id').as('count'),
    fn
      .sum(fn.count('id'))
      .over((ob) => ob.orderBy(fn as any))
      .as('cumulative_count'),
  ];
}

