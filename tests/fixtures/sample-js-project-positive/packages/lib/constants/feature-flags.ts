// Single constants file checks env var === 'true'; standard boolean-string env check, one usage
export const MAINTENANCE_MODE_ENABLED = process.env['APP_MAINTENANCE_MODE'] === 'true';
export const ANALYTICS_ENABLED = process.env['APP_ANALYTICS_ENABLED'] === 'true';
export const BETA_FEATURES_ENABLED = process.env['APP_BETA_FEATURES'] === 'true';
