
// Normalize line endings in email template bodies to \n
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}



// Validate webhook delivery ID format (ASCII prefix pattern)
export function isValidDeliveryId(id: string): boolean {
  return /^delivery_.{2,}$/.test(id);
}



// Validate numeric input: digits, commas, and decimal points only (ASCII)
export function isValidNumberInput(value: string): boolean {
  return /^[0-9,.]+$/.test(value);
}



// Substitute {{variable}} placeholders in template strings
export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\S+)\}/g, (_, key) => variables[key] ?? _);
}



// Validation regex for numeric field format (digits and punctuation only)
export const NUMBER_FORMAT_REGEX = /^[0-9,.()+\-]+$/;

export function isValidFormattedNumber(value: string): boolean {
  return NUMBER_FORMAT_REGEX.test(value);
}



// ASCII special character validation for password strength checking
const PASSWORD_SPECIAL_CHARS_REGEX = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;

export function hasSpecialCharacter(password: string): boolean {
  return PASSWORD_SPECIAL_CHARS_REGEX.test(password);
}

export function validatePasswordStrength(password: string): {
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
  isLongEnough: boolean;
} {
  return {
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasDigit: /[0-9]/.test(password),
    hasSpecial: hasSpecialCharacter(password),
    isLongEnough: password.length >= 8,
  };
}
