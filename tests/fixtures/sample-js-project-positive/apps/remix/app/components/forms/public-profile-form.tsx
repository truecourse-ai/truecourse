
declare function formatUserProfilePath(slug: string): string;

// Protocol-stripping regex /https?:\/\// on a URL — ASCII-only pattern, unicode flag unnecessary.
export function getDisplayProfileUrl(slug: string): string {
  return formatUserProfilePath(slug).replace(/https?:\/\//, '');
}
