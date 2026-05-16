
// --- env-in-library-code shape: single-purpose-config-resolver-function ---
// This file is the dedicated entrypoint for resolving the deleted-account
// service address. Reading process.env here is intentional — this module
// exists solely to normalise and expose this configuration value.
const LEGACY_DELETED_ACCOUNT_EMAIL = 'deleted-account@example.com';

export const deletedServiceAccountEmail = (): string => {
  try {
    if (process.env.APP_DELETED_SERVICE_ACCOUNT_EMAIL) {
      return process.env.APP_DELETED_SERVICE_ACCOUNT_EMAIL;
    }
    const { hostname } = new URL(process.env.APP_PUBLIC_URL || 'http://localhost:3000');
    return `deleted-account@${hostname}`;
  } catch {
    return LEGACY_DELETED_ACCOUNT_EMAIL;
  }
};



// shape: single-purpose-config-resolver-function — secondary env-based override
export const resolvedServiceAccountEmail = (): string => {
  const override = process.env.APP_DELETED_SERVICE_ACCOUNT_EMAIL;
  if (override) {
    return override;
  }
  try {
    const { hostname } = new URL(process.env.APP_PUBLIC_URL || 'http://localhost:3000');
    return `system-account@${hostname}`;
  } catch {
    return 'system-account@example.com';
  }
};



// shape: single-purpose-config-resolver-function — tertiary fallback reads env var
export const legacyServiceAccountEmail = (): string => {
  return process.env.APP_LEGACY_SERVICE_ACCOUNT_EMAIL ?? 'legacy-account@example.com';
};
