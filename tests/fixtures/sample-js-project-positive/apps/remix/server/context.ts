
// URL path prefix regex for API/internal routes — ASCII path strings, unicode flag not needed.
const BLACKLISTED_PATHS_REGEX = /^\/api\/|^\/__/;

export function isBlacklistedPath(pathname: string): boolean {
  return BLACKLISTED_PATHS_REGEX.test(pathname);
}
