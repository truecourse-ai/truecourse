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



// ---------------------------------------------------------------------------
// Mode: error-code-enum-token-pair
//
// `AuthenticationErrorCode` is an error-code enum object. Its keys describe
// the *kind* of error (e.g. `InvalidToken`, `MissingToken`) and the string
// values are the wire-format error identifiers returned by the API. The
// values are symbolic uppercase tags, not tokens that grant access — they
// have no entropy, no expiry, and are checked into source intentionally
// because callers `switch` on them. The hardcoded-secret rule should not
// flag these even though the property names contain "token".
// ---------------------------------------------------------------------------
export const AuthenticationErrorCode = {
  AccountDisabled: 'ACCOUNT_DISABLED',
  Unauthorized: 'UNAUTHORIZED',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  SessionExpired: 'SESSION_EXPIRED',
  InvalidToken: 'INVALID_TOKEN',
  MissingToken: 'MISSING_TOKEN',
  InvalidTwoFactorCode: 'INVALID_TWO_FACTOR_CODE',
} as const;

export type AuthenticationErrorCode =
  (typeof AuthenticationErrorCode)[keyof typeof AuthenticationErrorCode];

declare const apiResponse: { code: AuthenticationErrorCode; message: string };

export function isTokenAuthFailure(): boolean {
  return (
    apiResponse.code === AuthenticationErrorCode.InvalidToken ||
    apiResponse.code === AuthenticationErrorCode.MissingToken
  );
}

// ---------------------------------------------------------------------------
// Mode: token-identifier-lookup-key-const
//
// `*_VERIFICATION_TOKEN_IDENTIFIER` constants are *category labels* used as
// database lookup keys to namespace verification-token rows by purpose
// ("confirmation-email" vs. "organisation-account-link" vs. ...). The token
// itself is a separate, random column on the same row; these strings are
// the discriminator, not the credential. They are kebab-case dictionary
// keys with no entropy and are referenced from many call-sites, so they
// must be checked into source. The hardcoded-secret rule should not flag
// them even though the variable names contain "TOKEN".
// ---------------------------------------------------------------------------
export const USER_SIGNUP_VERIFICATION_TOKEN_IDENTIFIER = 'confirmation-email';
export const ORGANISATION_ACCOUNT_LINK_VERIFICATION_TOKEN_IDENTIFIER = 'organisation-account-link';
export const PASSWORD_RESET_VERIFICATION_TOKEN_IDENTIFIER = 'password-reset-request';

declare const verificationTokensRepo: {
  findByIdentifier: (identifier: string) => Promise<{ token: string; userId: string } | null>;
};

export async function findSignupConfirmation(): Promise<string | null> {
  const row = await verificationTokensRepo.findByIdentifier(
    USER_SIGNUP_VERIFICATION_TOKEN_IDENTIFIER,
  );
  if (!row) return null;
  return row.userId;
}

export async function findOrganisationAccountLink(): Promise<string | null> {
  const row = await verificationTokensRepo.findByIdentifier(
    ORGANISATION_ACCOUNT_LINK_VERIFICATION_TOKEN_IDENTIFIER,
  );
  return row?.userId ?? null;
}

export async function findPasswordResetRequest(): Promise<string | null> {
  const row = await verificationTokensRepo.findByIdentifier(
    PASSWORD_RESET_VERIFICATION_TOKEN_IDENTIFIER,
  );
  return row?.userId ?? null;
}
