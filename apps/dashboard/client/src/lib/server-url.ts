/**
 * Returns the API server URL.
 *
 * - Production (packaged): frontend is served by Express on the same origin → ''
 * - Development: Next.js runs on port 3000, Express on 5555 → derive from hostname
 */
export function getServerUrl(): string {
  if (typeof window === 'undefined') return '';
  // When frontend runs on its own port (dev or local prod via `pnpm start`),
  // API is on port 5555. When served by Express (npm package), same origin.
  const port = window.location.port;
  if (port && port !== '5555') {
    return `http://${window.location.hostname}:5555`;
  }
  return '';
}
