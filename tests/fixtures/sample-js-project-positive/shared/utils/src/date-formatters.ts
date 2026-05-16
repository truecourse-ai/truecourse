
// --- unknown-catch-variable shape: catch(error) console.error('prefix:', error, extraArg) + return fallback ---
declare function parseYearMonth(date: string): { year: string; month: string } | null;
declare function buildDateTime(year: number, month: number): { isValid: boolean; toFormat(fmt: string): string };

function formatMonthYear(date: string): string {
  try {
    const parsed = parseYearMonth(date);

    if (!parsed) {
      console.warn(`Unable to parse date: ${date}`);
      return date;
    }

    const dt = buildDateTime(Number(parsed.year), Number(parsed.month));

    if (!dt.isValid) {
      console.warn(`Invalid DateTime object for: ${date}`);
      return date;
    }

    return dt.toFormat('MMM yyyy');
  } catch (error) {
    console.error('Error formatting date:', error, date);
    return date;
  }
}
