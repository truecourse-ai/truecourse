export const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ef4444',
  medium: '#f97316',
  low: '#f59e0b',
  info: '#3b82f6',
};

export const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function getHighestSeverity(severities: string[]): string | null {
  if (severities.length === 0) return null;
  return severities.reduce((worst, s) =>
    (SEVERITY_ORDER[s] ?? 5) < (SEVERITY_ORDER[worst] ?? 5) ? s : worst
  );
}
