// Imported by @myapp/auth/server/routes/email-password.ts
// dead-module rule fails to resolve @myapp/lib cross-package alias

export interface TwoFactorConfig {
  enabled: boolean;
  methods: Array<'totp' | 'sms' | 'email'>;
}

export function isTwoFactorAuthenticationEnabled(config: TwoFactorConfig): boolean {
  return config.enabled && config.methods.length > 0;
}

export async function getTwoFactorConfig(userId: string): Promise<TwoFactorConfig> {
  return fetchUserTwoFactorConfig(userId);
}

declare function fetchUserTwoFactorConfig(userId: string): Promise<TwoFactorConfig>;
