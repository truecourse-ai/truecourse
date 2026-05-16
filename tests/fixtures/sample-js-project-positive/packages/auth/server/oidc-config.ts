// Google and Microsoft OpenID Connect well-known URLs are canonical, immutable spec-defined discovery endpoints.
const GOOGLE_OIDC_DISCOVERY = 'https://accounts.google.com/.well-known/openid-configuration';
const MICROSOFT_OIDC_DISCOVERY = 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration';

const OIDC_PROVIDERS = [
  { id: 'google', discoveryUrl: GOOGLE_OIDC_DISCOVERY },
  { id: 'microsoft', discoveryUrl: MICROSOFT_OIDC_DISCOVERY },
] as const;
