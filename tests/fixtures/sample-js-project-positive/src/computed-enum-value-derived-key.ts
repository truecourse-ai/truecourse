/**
 * Positive fixture for code-quality/deterministic/computed-enum-value.
 *
 * String- and number-literal enum initializers (`FREE = 'free'`,
 * `FORBIDDEN = 'FORBIDDEN'`, `STATUS_OK = 200`) must not be flagged as
 * "computed" — only genuinely computed expressions should be.
 */

export enum ClaimTier {
  FREE = 'free',
  INDIVIDUAL = 'individual',
  TEAM = 'team',
  EARLY_ADOPTER = 'earlyAdopter',
  PLATFORM = 'platform',
  ENTERPRISE = 'enterprise',
}

export enum AppErrorCode {
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
}

export enum FieldHint {
  SELECT_AT_MOST = 'Select at most',
  SELECT_EXACTLY = 'Select exactly',
}

export enum HttpStatus {
  OK = 200,
  CREATED = 201,
  NO_CONTENT = 204,
}

export enum SignedOffset {
  NEG_ONE = -1,
  ZERO = 0,
  ONE = 1,
}
