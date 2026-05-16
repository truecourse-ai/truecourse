

// Positive sample: argument-type-mismatch — the existing getUserMonthlyGrowth uses
// Kysely window function with intentional `as any` cast around fn('DATE_TRUNC', ...).
// Additional helper for file validity:
function formatGrowthLabel(month: Date, locale: string): string {
  return month.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
}

