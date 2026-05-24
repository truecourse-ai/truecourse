/**
 * OAuth/OIDC provider `.well-known/openid-configuration` URLs are
 * standardized discovery endpoints published by the identity provider
 * itself — there is no environment-specific form of these URLs.
 * Flagging them as "should move to config/env" is a false positive
 * because the provider, not the caller, owns the URL.
 */

type OAuthProviderConfig = {
  id: string;
  scope: string[];
  clientId: string;
  clientSecret: string;
  wellKnownUrl: string;
};

declare function readSecret(key: string): string;

export const googleProvider: OAuthProviderConfig = {
  id: 'google',
  scope: ['openid', 'email', 'profile'],
  clientId: readSecret('GOOGLE_CLIENT_ID'),
  clientSecret: readSecret('GOOGLE_CLIENT_SECRET'),
  wellKnownUrl: 'https://accounts.google.com/.well-known/openid-configuration',
};

export const microsoftProvider: OAuthProviderConfig = {
  id: 'microsoft',
  scope: ['openid', 'email', 'profile'],
  clientId: readSecret('MICROSOFT_CLIENT_ID'),
  clientSecret: readSecret('MICROSOFT_CLIENT_SECRET'),
  wellKnownUrl: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
};
