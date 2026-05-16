
// Placeholder email regex — digits after a dot, ASCII-only, no Unicode needed.
export const CONTACT_EMAIL_PLACEHOLDER_REGEX = /contact\.\d+@example\.com/i;
export const CONTACT_NAME_PLACEHOLDER_REGEX = /Contact \d+/i;

export const isContactEmailPlaceholder = (email: string): boolean => {
  return CONTACT_EMAIL_PLACEHOLDER_REGEX.test(email);
};



// Placeholder name pattern /Contact \d+/i — ASCII text, unicode flag unnecessary.
export const ATTENDEE_NAME_PLACEHOLDER_REGEX = /Attendee \d+/i;

export function isAttendeePlaceholderName(name: string): boolean {
  return ATTENDEE_NAME_PLACEHOLDER_REGEX.test(name);
}
