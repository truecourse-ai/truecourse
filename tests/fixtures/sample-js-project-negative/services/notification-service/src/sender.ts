/**
 * Email sender — handles SMTP connection and delivery.
 */

// NOTE: code-quality/deterministic/env-in-library-code — skipped for non-packages files
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.example.com';
// NOTE: code-quality/deterministic/env-in-library-code — skipped for non-packages files
const SMTP_PORT = process.env.SMTP_PORT || '587';

interface EmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export async function sendEmail(to: string, subject: string, html: string) {
  // VIOLATION: reliability/deterministic/http-call-no-timeout
  const response = await fetch(`http://${SMTP_HOST}:${SMTP_PORT}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, html }),
  });

  if (!response.ok) {
    throw new Error(`Email send failed: ${response.statusText}`);
  }

  return response.json() as Promise<EmailResult>;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export async function sendBulkEmails(
  // VIOLATION: code-quality/deterministic/readonly-parameter-types
  recipients: string[],
  subject: string,
  html: string,
) {
  const results: EmailResult[] = [];

  for (const recipient of recipients) {
    // VIOLATION: bugs/deterministic/await-in-loop
    const result = await sendEmail(recipient, subject, html);
    results.push(result);
  }

  return results;
}

// VIOLATION: code-quality/deterministic/missing-return-type
export function validateEmailAddress(email: string) {
  // VIOLATION: bugs/deterministic/redos-vulnerable-regex
  const emailRegex = /^([a-zA-Z0-9]+)*@[a-zA-Z0-9]+\.[a-zA-Z]+$/;
  return emailRegex.test(email);
}
