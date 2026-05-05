/**
 * Equality checks against enum values / type-tag string literals are NOT
 * timing-attack-vulnerable. The `timing-attack-comparison` rule fires on
 * any `===` / `!==` whose left or right text matches keywords like
 * `signature`, `token`, `password`, etc. — but enum members named
 * `SIGNATURE` / `TOKEN` (or string literals like `'SIGNATURE'`) are
 * field-type tags, not credentials.
 *
 * Mirrors documenso's
 *   apps/remix/app/components/embed/.../configure-fields-view.tsx:533
 *   apps/remix/app/components/embed/.../embed-direct-template-client-page.tsx:131
 */

export enum FieldType {
  TEXT = 'TEXT',
  SIGNATURE = 'SIGNATURE',
  CHECKBOX = 'CHECKBOX',
  EMAIL = 'EMAIL',
}

interface Field {
  readonly type: FieldType;
  readonly value: string;
}

export function isSignatureField(field: Field): boolean {
  // Member-access enum check — the `.SIGNATURE` property on `FieldType`
  // is an enum member, not a credential value.
  return field.type === FieldType.SIGNATURE;
}

export function isSelectedSignature(selectedField: string): boolean {
  // String-literal enum tag check — `'SIGNATURE'` is an upper-case
  // identifier-shaped string, not a real signature.
  return selectedField === 'SIGNATURE';
}

export function fieldTypeIsNot(field: Field, kind: FieldType): boolean {
  return field.type !== kind;
}
