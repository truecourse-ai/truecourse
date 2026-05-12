import { logger } from '@sample/shared-utils';
import { authMiddleware } from '../../api-gateway/src/middleware/auth';
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
export function validateInput(type: string, recipient: string): boolean {
  return type.length > 0 && recipient.length > 0;
}
export function getStatusCodes(): { bad: number; notFound: number } {
  return { bad: HTTP_BAD_REQUEST, notFound: HTTP_NOT_FOUND };
}
export function init(): void {
  logger.info(`Notification init: ${typeof authMiddleware}`);
}
process.on('uncaughtException', (err: Error) => {
  console.error(err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error(String(reason));
  process.exit(1);
});



/**
 * Positive fixtures for reliability/deterministic/console-error-no-context.
 *
 * The rule fires on `console.error(<bare-err-ident>)` where the single
 * argument is an identifier named `e` / `err` / `error` / `ex`. The audit
 * collected three documenso shapes where the call is preceded by a paired
 * context log on the prior line. Those shapes still fire the rule today —
 * the prior call is a sibling statement, not a wrapper, and the visitor
 * only looks at the offending call's own argument list. They are kept here
 * as positive TPs so any future suppression that 'looks back one line' is
 * caught by the negative-contract check.
 */

declare const renderError: unknown;
declare const licenseError: unknown;
declare const seedFailure: unknown;

// Mode shape-f224dbde2e0f: console.error('context message') immediately
// followed by console.error(err). Mirrors documenso
// envelope-signer-page-renderer.tsx:443-444. The bare-identifier second
// call still triggers — context lives in a separate statement.
export function renderEnvelopeFields(): void {
  try {
    void renderError;
  } catch (err) {
    console.error('Unable to render one or more fields belonging to other recipients.');
    console.error(err);
  }
}

// Mode shape-1d640128e18a: console.warn('[License] ...') followed by
// console.error(err). Mirrors documenso license-client.ts:105-106. The
// preceding warn is a different console method on a sibling statement;
// the error call's own argument is a bare identifier and still violates.
export function refreshLicenseCache(): void {
  try {
    void licenseError;
  } catch (err) {
    console.warn('[License] License server not responding, using cached license.');
    console.error(err);
  }
}

// Mode shape-ea595847c3cb: '[SEEDING]:' context line followed by
// console.error(err) inside a seed-like helper. Mirrors documenso
// seed/large-team-seed.ts:58-59. The visitor has no seed-path exemption;
// the bare-identifier call still triggers.
export function seedLargeTeam(): void {
  try {
    void seedFailure;
  } catch (err) {
    console.error('[SEEDING]: Failed to seed large team.');
    console.error(err);
  }
}

// Mode shape-f224dbde2e0f variant — same paired-context shape, but the
// caught identifier is `error` rather than `err`. The rule's identifier
// allow-list (`e`/`err`/`error`/`ex`) keeps this firing.
export function seedDatabase(): void {
  try {
    void seedFailure;
  } catch (error) {
    console.error('Database seed failed.');
    console.error(error);
  }
}
