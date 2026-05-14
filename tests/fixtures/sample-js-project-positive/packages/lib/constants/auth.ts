
// URL pattern detection /https?:\/\/|www\./i — ASCII-only, unicode flag adds no value.
export const URL_PRESENCE_PATTERN = /https?:\/\/|www\./i;

export function containsUrl(text: string): boolean {
  return URL_PRESENCE_PATTERN.test(text);
}
