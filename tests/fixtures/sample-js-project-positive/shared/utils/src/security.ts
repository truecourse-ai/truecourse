import { readFileSync as readFileSyncForFixture } from 'node:fs';
import { join as joinForFixture } from 'node:path';

export function sanitizeInput(input: string): string { return input.replace(/[<>&'"]/gu, ''); }
export function buildSafePath(filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/gu, '');
  return `/uploads/${safeName}`;
}
export function createUserFromWhitelist(input: { name: string; email: string }): Record<string, string> {
  return { name: input.name, email: input.email };
}
export function performSafeQuery(userId: string): string {
  return `SELECT id, name FROM users WHERE id = ${userId}`;
}
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0';
export function getUA(): string { return USER_AGENT; }

// positive: clear-text-protocol — checking for http:// in validation should NOT trigger
export function isHttpUrl(input: string): boolean {
  return input.startsWith('http://');
}

// Positive: sensitive-data-in-url — invitation token in URL (not a secret/password)
export function inviteUrl(invitationToken: string): string {
  return `/accept?invitation=${invitationToken}`;
}

// ---------------------------------------------------------------------------
// findUserInputAccess substring-leak FPs (Phase 2)
//
// Pre-fix, the security visitors used `argText.includes('req.')`,
// `.includes('body')`, `.includes('query')` etc. — which leaked across
// substrings (everyBody, bodyParser, subQuery, queryBuilder).
// ---------------------------------------------------------------------------

declare const queryBuilder: { build(): string };

// Positive: user-input-in-path — `queryBuilder` substring-collides with 'query'
// (and the local var `bodyContent` collides with 'body'). Neither is user input.
export function readWithQueryBuilderPath(): string {
  const filename = `/etc/${queryBuilder.build()}`;
  return readFileSyncForFixture(filename, 'utf-8');
}

// Positive: user-input-in-path — local var `bodyContent` collides with 'body'
export function readBodyContent(): string {
  const bodyContent = '/safe/path.txt';
  return readFileSyncForFixture(bodyContent, 'utf-8');
}

// Positive: path-command-injection — local var `subQueryPath` collides with 'query'
export function joinSubQueryPath(): string {
  const subQueryPath = 'sub/query';
  return joinForFixture('/base', subQueryPath);
}

// Positive: user-input-in-redirect — local var `returnUrl` collides with 'returnurl'
declare const responseObj: { redirect(url: string): void };
export function safeReturnRedirect(): void {
  const returnUrl = '/dashboard';
  responseObj.redirect(returnUrl);
}
