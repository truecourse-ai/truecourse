
// --- env-in-library-code shape: module-level-config-constants ---
// Telemetry configuration constants read from environment at module load time.
// This module IS the telemetry client — reading process.env here is intentional.
const HAS_LICENSE_KEY = !!process.env.APP_LICENSE_KEY;

const TELEMETRY_KEY = process.env.APP_TELEMETRY_KEY;
export { TELEMETRY_KEY };



const TELEMETRY_HOST = process.env.APP_TELEMETRY_HOST;
export { TELEMETRY_HOST };



const TELEMETRY_DISABLED =
  !!process.env.APP_DISABLE_TELEMETRY || !!process.env.APP_LICENSE_KEY;
export { TELEMETRY_DISABLED };



const NODE_ID_FILENAME = '.app-node-id';
const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
const _telemetryVersion = process.env.APP_VERSION ?? '0.0.0';
export { NODE_ID_FILENAME, HEARTBEAT_INTERVAL_MS, _telemetryVersion };
