
// Organisation URL root regex — /^\/o\/[^/]+\/?$/ is pure ASCII path pattern.
export const ORG_URL_ROOT_REGEX = /^\/o\/[^/]+\/?$/;
export const ORG_URL_PREFIX_REGEX = /^\/o\/[^/]+/;



// Organisation URL prefix match — /^\/o\/[^/]+/ is ASCII URL path, unicode flag unnecessary.
export const ORG_URL_MATCH_REGEX = /^\/org\/[^/]+/;

export function isOrgPath(pathname: string): boolean {
  return ORG_URL_MATCH_REGEX.test(pathname);
}
