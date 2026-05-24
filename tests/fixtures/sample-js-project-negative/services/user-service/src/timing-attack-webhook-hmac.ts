// True bug: HMAC signature verification with a plain `===` compare is
// vulnerable to timing attacks. The attacker can guess the signature
// byte-by-byte by measuring how long the compare takes to fail. Use
// a constant-time comparison helper instead.

export function verifyWebhook(providedSignature: string, expectedSignature: string): boolean {
  // VIOLATION: security/deterministic/timing-attack-comparison
  return providedSignature === expectedSignature;
}
