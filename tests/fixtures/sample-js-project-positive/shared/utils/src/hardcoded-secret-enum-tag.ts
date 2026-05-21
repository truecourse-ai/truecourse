// Error-code enum: property values are UPPER_SNAKE_CASE tags that mirror
// the property key. These are dispatch identifiers, not credentials, but
// the property names contain "token" which would otherwise trip the
// hardcoded-secret variable-name fallback.
export const AuthErrorCode = {
  InvalidToken: 'INVALID_TOKEN',
  MissingToken: 'MISSING_TOKEN',
  ExpiredToken: 'EXPIRED_TOKEN',
  RevokedToken: 'REVOKED_TOKEN',
} as const;

export type AuthErrorCode =
  (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

// Kebab-case identifier used as a token-purpose discriminator. The
// constant name ends in TOKEN_IDENTIFIER but the value is a public
// human-readable label, not a credential.
export const ACCOUNT_LINK_VERIFICATION_TOKEN_IDENTIFIER =
  'account-link-verification';
export const SIGNUP_CONFIRMATION_TOKEN_IDENTIFIER = 'confirmation-link';
