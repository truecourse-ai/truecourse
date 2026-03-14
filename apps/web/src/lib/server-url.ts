/**
 * Returns the API server URL.
 *
 * - Production (packaged): frontend is served by Express on the same origin → ''
 * - Development: Next.js runs on port 3000, Express on 3001 → derive from hostname
 */
export function getServerUrl(): string {
  if (typeof window === 'undefined') return '';
  if (process.env.NODE_ENV === 'development') {
    return `http://${window.location.hostname}:3001`;
  }
  return '';
}
