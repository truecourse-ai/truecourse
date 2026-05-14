
// Intl.Locale constructor called for side-effect validation (throws on invalid tag)
export function validateLocaleTag(tag: string): boolean {
  try {
    new Intl.Locale(tag);
    return true;
  } catch {
    return false;
  }
}

export function assertValidLocale(tag: string): void {
  // Throws RangeError if invalid BCP-47 tag; result intentionally discarded
  new Intl.Locale(tag);
}
