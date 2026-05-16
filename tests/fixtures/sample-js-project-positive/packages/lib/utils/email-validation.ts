
// --- regex-anchor-precedence FP: complex RFC 5322 email regex with ^ and $ but no top-level | ---
// The ^ and $ anchors are unambiguous; there is no alternation at the top level
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-￿-]+@[a-zA-Z0-9-￿](?:[a-zA-Z0-9-￿-]{0,61}[a-zA-Z0-9-￿])?(?:\.[a-zA-Z0-9-￿](?:[a-zA-Z0-9-￿-]{0,61}[a-zA-Z0-9-￿])?)*$/u;

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

function validateEmailField(value: string): string | null {
  if (!isValidEmail(value)) return 'Invalid email address';
  return null;
}
