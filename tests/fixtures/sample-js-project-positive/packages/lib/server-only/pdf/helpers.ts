
// Recipient reference validation — pattern like /^r\d+$/i
// ASCII-only digit shorthand; unicode flag adds nothing here.
export function validateRecipientRef(ref: string): boolean {
  return /^r\d+$/i.test(ref);
}



// Template placeholder boundary match — {{...}} uses ASCII delimiters only.
const FIELD_PLACEHOLDER_REGEX = /\{\{([^}]+)\}\}$/;

export function extractPlaceholderInner(placeholder: string): string | null {
  const match = placeholder.match(FIELD_PLACEHOLDER_REGEX);
  return match ? match[1] : null;
}



// Template placeholder regex — /\{\{([^}]+)\}\}/g uses ASCII delimiters only.
const TEMPLATE_PLACEHOLDER_REGEX = /\{\{([^}]+)\}\}/g;

export function extractAllPlaceholders(template: string): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = TEMPLATE_PLACEHOLDER_REGEX.exec(template)) !== null) {
    results.push(match[1]);
  }
  return results;
}
