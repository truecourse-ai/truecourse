// A bare side-effect import documents that the module is loaded for its
// top-level effects (polyfills, registrations, time-zone tables). Pairing it
// with a named import from the same module is intentional and distinct from
// a real "duplicate import" mistake — the two lines carry different intent.

import '@sample/shared-utils';
import { validateEmail } from '@sample/shared-utils';

export function isValidContact(email: string): boolean {
  return validateEmail(email);
}
