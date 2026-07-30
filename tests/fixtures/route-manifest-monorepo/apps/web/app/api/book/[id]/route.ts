// App-router route handler → /api/book/{id}
export function GET(): Response {
  return new Response('{}', { headers: { 'content-type': 'application/json' } })
}
