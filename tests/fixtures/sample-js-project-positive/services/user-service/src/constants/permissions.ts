/**
 * Permission keys and error-code identifiers.
 * The string values are stable identifiers used in JWTs / RPC payloads —
 * they are NOT credentials.
 */

export const Permission = {
  ManageSecrets: 'manage_secrets',
  ManageApiKeys: 'manage_api_keys',
  ManageWebhooks: 'manage_webhooks',
  ViewBilling: 'view_billing',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export const ErrorCode = {
  InvalidToken: 'INVALID_TOKEN',
  MissingToken: 'MISSING_TOKEN',
  ExpiredToken: 'EXPIRED_TOKEN',
  InvalidApiKey: 'INVALID_API_KEY',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export const USER_SIGNUP_VERIFICATION_TOKEN_IDENTIFIER = 'confirmation-email';
export const ORGANISATION_ACCOUNT_LINK_VERIFICATION_TOKEN_IDENTIFIER = 'organisation-account-link';
export const INVITATION_TOKEN_KEY = 'app_invitation_token';
export const REMOTE_API_KEY = 'app_remote_api';

export const ServiceTokenEnvVar = {
  GitHub: 'GITHUB_TOKEN',
  GitLab: 'GITLAB_TOKEN',
  Bitbucket: 'BITBUCKET_TOKEN',
} as const;

export const SESSION_API_KEY_VARIABLE = 'APP_SESSION_API_KEYS_0';
