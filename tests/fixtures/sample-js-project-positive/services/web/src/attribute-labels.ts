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



// Shape: translation call t(LABEL_MAP[field.type]) with string argument — no type mismatch
declare function t(msg: string): string;

const FIELD_LABEL_MAP: Record<string, string> = {
  text: 'Text Field',
  signature: 'Signature Field',
  date: 'Date Field',
  checkbox: 'Checkbox Field',
};

export function getFieldTypeLabel(fieldType: string): string {
  return t(FIELD_LABEL_MAP[fieldType]);
}
