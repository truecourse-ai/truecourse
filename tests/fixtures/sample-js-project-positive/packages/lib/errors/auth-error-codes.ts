// Error code enum values are symbolic identifiers for error conditions — not actual secret token values
export const AuthErrorCode = {
  InvalidToken: 'INVALID_TOKEN',
  MissingToken: 'MISSING_TOKEN',
  ExpiredToken: 'EXPIRED_TOKEN',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  SessionNotFound: 'SESSION_NOT_FOUND',
  Unauthorized: 'UNAUTHORIZED',
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];
