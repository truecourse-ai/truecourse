
// Prisma query logger — console.log inside a $on('query') debug listener
// intentionally prints SQL queries for development diagnostics.
declare const dbClient: { $on(event: 'query', cb: (e: { query: string; params: string; duration: number }) => void): void };

dbClient.$on('query', (e) => {
  console.log('query:', e.query);
  console.log('params:', e.params);
  console.log('duration:', e.duration);
});



// Prisma query logger — console.log printing the formatted SQL query inside
// a $on('query') debug listener. Same intentional dev-mode diagnostics.
declare const db: { $on(event: 'query', cb: (e: { query: string; params: string }) => void): void };

db.$on('query', (e) => {
  const params = JSON.parse(e.params) as unknown[];
  const formatted = e.query.replace(/\$\d+/g, (match) => {
    const idx = Number(match.replace('$', ''));
    return idx <= params.length ? String(params[idx - 1]) : match;
  });
  console.log('formatted query:', formatted);
});



// Prisma query logger — console.log printing query duration inside
// a $on('query') debug listener. Intentional dev-mode SQL diagnostics.
declare const queryClient: { $on(event: 'query', cb: (e: { query: string; duration: number }) => void): void };

queryClient.$on('query', (e) => {
  console.log('query:', e.query);
  console.log('duration:', `${e.duration}ms`);
});
