// Aggregated fixture for natural rule shape coverage.

// shape 7bab5288: unpredictable-salt-missing — fixed salt in password hash
declare const hashFn_7bab5288: (pw: string, salt: string) => string;
export function hashPassword_7bab5288(password: string): string {
  return hashFn_7bab5288(password, "static-salt-7bab5288");
}

