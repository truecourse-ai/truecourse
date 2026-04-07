/**
 * Clean code patterns that should NOT trigger any rules.
 *
 * Named constants instead of magic numbers.
 * Explicit comparisons with triple-equals and bang-equals.
 * No var declarations anywhere.
 * Template literals instead of string concatenation.
 */

const MAX_RETRIES = 3;
const MIN_PASSWORD_LENGTH = 8;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

export function isValidStatus(status: number): boolean {
  return status === HTTP_OK;
}

export function isNotFound(status: number): boolean {
  return status === HTTP_NOT_FOUND;
}

export function isNonEmpty(value: string): boolean {
  return value !== '';
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function formatError(code: number, message: string): string {
  return `Error ${code}: ${message}`;
}

export function buildUrl(base: string, path: string): string {
  return `${base}/${path}`;
}

export function processItems(items: readonly string[]): string[] {
  return items
    .filter((item) => item.length > 0)
    .map((item) => item.trim());
}

interface PasswordValidation {
  valid: boolean;
  reason: string;
}

export function validatePassword(password: string): PasswordValidation {
  const result: PasswordValidation = { valid: true, reason: '' };
  if (password.length < MIN_PASSWORD_LENGTH) {
    result.valid = false;
    result.reason = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return result;
}

export function retryOperation(fn: () => boolean): boolean {
  let attempts = 0;
  while (attempts < MAX_RETRIES) {
    if (fn()) {
      return true;
    }
    attempts++;
  }
  return false;
}
