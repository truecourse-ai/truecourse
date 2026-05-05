/**
 * Equality checks against `''`, `null`, `undefined`, `true`, `false`,
 * numbers, or object `.id` / `.length` are presence/state checks — not
 * credential comparisons. The `timing-attack-comparison` rule fires on
 * the keyword `signature` / `token` / `password` regardless of operand
 * type; literal empty/null/boolean operands have no timing-attack risk.
 *
 * Mirrors documenso's
 *   apps/remix/app/components/embed/embed-direct-template-client-page.tsx:112
 *   apps/remix/app/components/forms/password.tsx:32
 *   apps/remix/app/routes/.../settings.sso.tsx:139
 */

interface FormProps {
  readonly signature: string | undefined;
  readonly clientSecret: string;
  readonly token: { readonly id: string } | null;
  readonly newlyCreatedTokenId: string;
  readonly typedSignatureEnabled: boolean;
}

export function isSignatureValid(p: FormProps): boolean {
  // Presence checks against empty string.
  return p.signature !== undefined && p.signature.trim() !== '';
}

export function isClientSecretSet(p: FormProps): boolean {
  return p.clientSecret !== '';
}

export function isTokenMatch(p: FormProps): boolean {
  // Object id comparison — both internal IDs.
  return p.token !== null && p.token.id === p.newlyCreatedTokenId;
}

export function isTypedSignatureOff(p: FormProps): boolean {
  return p.typedSignatureEnabled === false;
}

// UI form validation pattern — both sides are local form state.
export function passwordsMatch(data: { password: string; repeatedPassword: string }): boolean {
  return data.password === data.repeatedPassword;
}
