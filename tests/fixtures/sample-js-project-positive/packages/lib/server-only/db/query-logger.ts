
declare const JSON: { parse: (s: string) => unknown[] };

// Prisma query param replacement /\$\d+/g — ASCII literal pattern, unicode flag unnecessary.
export function interpolateQuery(query: string, paramsJson: string): string {
  const params = JSON.parse(paramsJson) as unknown[];
  let i = 0;
  return query.replace(/\$\d+/g, () => JSON.stringify(params[i++]));
}
