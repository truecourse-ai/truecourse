
// FP: SALT_ROUNDS is imported at line 1 from a constants file; imports are hoisted ESM bindings.
// The analyzer is incorrectly treating an import binding as a forward reference.
declare const bcryptHashSync: (password: string, rounds: number) => string;
declare const bcryptCompareSync: (password: string, hash: string) => boolean;
declare const SALT_ROUNDS: number;

export function hashPassword(password: string): string {
  return bcryptHashSync(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcryptCompareSync(password, hash);
}



// Import of argon2Hash/argon2Verify from @node-rs/argon2 is not deprecated; only the re-exported wrapper in this file is marked @deprecated
import { hashSync as argon2Hash, verifySync as argon2Verify } from '@node-rs/argon2';

declare const HASH_OPTIONS: { timeCost: number; memoryCost: number };

/**
 * @deprecated Use the methods built into `argon2` instead
 */
export const hashPassword = (password: string) => {
  return argon2Hash(password, HASH_OPTIONS);
};

export const verifyPassword = (password: string, hash: string) => {
  return argon2Verify(hash, password, HASH_OPTIONS);
};
