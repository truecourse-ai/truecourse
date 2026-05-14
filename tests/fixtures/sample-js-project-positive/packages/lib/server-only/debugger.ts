
// env() === 'true' — standard boolean env flag comparison pattern
declare function env(key: string): string | undefined;

const featureFlags: Record<string, boolean> = {
  authDebug: env('NEXT_DEBUG_AUTH') === 'true',
  jobDebug: env('NEXT_DEBUG_JOB') === 'true',
  middlewareDebug: env('NEXT_DEBUG_MIDDLEWARE') === 'true',
};

export function isFeatureEnabled(feature: string): boolean {
  return featureFlags[feature.toLowerCase()] ?? false;
}
