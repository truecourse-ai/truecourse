
// --- redundant-template-expression FP: template literal on env() for URL construction ---
declare function env(key: string): string | undefined;

function buildDistributionUrl(objectKey: string): URL | null {
  const domain = env('UPLOAD_DISTRIBUTION_DOMAIN');
  if (!domain) return null;
  // Template coerces string|undefined to string — legitimate pattern
  return new URL(objectKey, `${domain}`);
}
