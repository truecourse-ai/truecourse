/**
 * Returns the API server URL.
 *
 * Always same-origin. In packaged production the Express server serves the
 * static frontend, so the API lives at the same origin. In dev, Vite proxies
 * `/api` and `/socket.io` to the backend (see vite.config.ts), so the browser
 * still talks to its own origin.
 */
export function getServerUrl(): string {
  return '';
}
