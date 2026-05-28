// Spec forbids any debug env-var in production builds. PROD_DEBUG gates
// verbose request logging and must not be read.
// IL-DRIFT: ForbiddenArtifact:env-var.prod-debug / forbidden.env-var.PROD_DEBUG.present
export const debugMode = process.env.PROD_DEBUG === 'true';

export function debugLog(...args: unknown[]): void {
  if (debugMode) console.log('[debug]', ...args);
}
