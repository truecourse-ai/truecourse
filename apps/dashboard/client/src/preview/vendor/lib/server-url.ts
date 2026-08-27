/**
 * Returns the API server URL, the base every HTTP request and the socket
 * connection hang off.
 *
 * Two worlds, told apart by the BUILD, never by the port the page happens to be
 * served on:
 *
 * - Dev (`import.meta.env.DEV`): Vite serves the client on :3000 while Express
 *   runs on :3001, so the API base is derived from the hostname with :3001
 *   forced. Two origins is the dev topology, and CORS on the server exists for it.
 * - Built: the dashboard server serves the client, so the API lives on the
 *   ORIGIN THAT SERVED THIS PAGE, whatever port that is. Deriving :3001 from
 *   the port would silently send a sandboxed or user-chosen-port dashboard's
 *   traffic to a foreign localhost:3001.
 *
 * `import.meta.env.DEV` is a build-time literal, so the dev branch is dead code
 * eliminated from the production bundle.
 */
export function getServerUrl(): string {
  if (typeof window === 'undefined') return '';
  if (import.meta.env.DEV) {
    // Client on its own port (Vite :3000) → the API is on :3001. Served from
    // :3001 already → same origin, no prefix.
    const port = window.location.port;
    if (port && port !== '3001') {
      return `http://${window.location.hostname}:3001`;
    }
    return '';
  }
  return window.location.origin;
}
