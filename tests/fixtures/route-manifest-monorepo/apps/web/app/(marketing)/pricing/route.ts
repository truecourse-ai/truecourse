// App-router route inside a ROUTE GROUP → /pricing (the `(marketing)` segment is
// organizational and never appears in the URL).
export function GET(): Response {
  return new Response('ok')
}
