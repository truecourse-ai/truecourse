
// Rule fires on the @deprecated declaration of USE_LEGACY_RENDERER itself, not on a call-site consuming a deprecated API
declare function env(key: string): string | undefined;

/**
 * Temporary flag to toggle between legacy and new rendering pipeline.
 *
 * @deprecated This is a temporary flag and will be removed once the new renderer is stable.
 */
export const USE_LEGACY_RENDERER = () => env('FEATURE_USE_LEGACY_RENDERER') === 'true';
