/**
 * Identity-investigation attribute taxonomy — UI display labels.
 *
 * In this domain, the literal `'Password'` is a *display label* for a
 * field-name — not a credential. The hardcoded-secret rule should not
 * flag any of these.
 */
export const ATTRIBUTE_LABELS = {
  email: 'Email',
  phone: 'Phone',
  password: 'Password',
  username: 'Username',
  ssn: 'SSN',
} as const;

export type AttributeType = keyof typeof ATTRIBUTE_LABELS;

export function labelFor(attribute: AttributeType): string {
  return ATTRIBUTE_LABELS[attribute];
}
