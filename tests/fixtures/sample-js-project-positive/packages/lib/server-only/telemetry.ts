

// --- missing-env-validation shape: boolean-presence-check-for-feature-flag ---
const HAS_LICENSE_KEY = !!process.env.APP_LICENSE_KEY;
const ANALYTICS_DISABLED = !!process.env.DISABLE_ANALYTICS || HAS_LICENSE_KEY;
const IS_DEBUG_MODE = !!process.env.DEBUG_LOGGING;

export function isTelemetryEnabled(): boolean {
  return !ANALYTICS_DISABLED && !IS_DEBUG_MODE;
}
