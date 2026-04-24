/**
 * Returns the API server URL.
 *
 * - Production (packaged): frontend is served by Express on the same origin → ''
 * - Development: Next.js runs on port 3000, Express on 3001 → derive from hostname
 */
export function getServerUrl(): string {
  if (typeof window === 'undefined') return '';
  // When frontend runs on its own port (dev or local prod via `pnpm start`),
  // API is on port 3001. When served by Express (npm package), same origin.
  const port = window.location.port;
  if (port && port !== '3001') {
    return `http://${window.location.hostname}:3001`;
  }
  return '';
}
