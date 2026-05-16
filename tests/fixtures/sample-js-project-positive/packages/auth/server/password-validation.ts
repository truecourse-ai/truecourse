
// --- regex-empty-group FP: [\] inside character class is an escaped bracket, not empty group ---
// The regex contains [...\-_"'+=|{}[\];:\\] — the [ and ] are literal bracket chars in the class
const SPECIAL_CHAR_REGEX = /[`~<>?,./!@#$%^&*()\-_"'+=|{}[\];:\\]/;

function hasSpecialCharacter(password: string): boolean {
  return SPECIAL_CHAR_REGEX.test(password);
}

function validatePassword(value: string): string | null {
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(value)) return 'One uppercase character required';
  if (!/[a-z]/.test(value)) return 'One lowercase character required';
  if (!/\d/.test(value)) return 'One number required';
  if (!hasSpecialCharacter(value)) return 'One special character required';
  return null;
}
