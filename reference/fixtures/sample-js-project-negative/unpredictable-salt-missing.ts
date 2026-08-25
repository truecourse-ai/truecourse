// A genuine unsalted password hash: the user's password is fed straight into
// a bare SHA-256 digest with no per-user salt, leaving it open to rainbow
// table attacks. A password-safe KDF (bcrypt/argon2/PBKDF2) should be used.

interface Hash {
  update(_input: string): Hash;
  digest(_encoding: string): string;
}

declare function createHash(_algorithm: string): Hash;

export function fingerprintCredential(password: string): string {
  // VIOLATION: security/deterministic/unpredictable-salt-missing
  return createHash("sha256").update(password).digest("hex");
}
