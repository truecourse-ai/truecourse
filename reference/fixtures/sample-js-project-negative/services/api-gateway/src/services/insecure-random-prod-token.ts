export function buildResetToken(): string {
  // VIOLATION: security/deterministic/insecure-random
  const token = Math.random().toString(36).slice(2, 18);
  return token;
}

export function buildApiSecret(): string {
  const prefix = 'sk_';
  // VIOLATION: security/deterministic/insecure-random
  return prefix + Math.random().toString(36).slice(2, 20);
}
