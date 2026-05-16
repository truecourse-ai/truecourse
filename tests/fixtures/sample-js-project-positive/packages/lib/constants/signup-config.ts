
// FP: isSignupEnabledForProvider returns boolean; its return value is used in conditionals.
declare function getEnvVar(key: string): string | undefined;

export function getPermittedEmailDomains(): string[] {
  const raw = getEnvVar('PERMITTED_EMAIL_DOMAINS');
  if (!raw) return [];
  return raw.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
}

export function isEmailPermitted(email: string): boolean {
  const domains = getPermittedEmailDomains();
  if (domains.length === 0) return true;
  const domain = email.toLowerCase().split('@').pop();
  if (!domain) return false;
  return domains.includes(domain);
}

export function isRegistrationEnabled(provider: 'email' | 'oauth' | 'saml'): boolean {
  if (getEnvVar('DISABLE_REGISTRATION') === 'true') return false;

  const flagMap: Record<typeof provider, string> = {
    email: 'DISABLE_EMAIL_REGISTRATION',
    oauth: 'DISABLE_OAUTH_REGISTRATION',
    saml: 'DISABLE_SAML_REGISTRATION',
  };

  return getEnvVar(flagMap[provider]) !== 'true';
}
