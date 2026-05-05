/**
 * `return Promise.all([...])` and `() => Promise.all([...])` are
 * deliberate hand-offs to the caller — the caller's try/catch is
 * responsible for the rejection. The rule must not fire on these.
 *
 * Mirrors documenso's
 *   apps/remix/app/components/general/document/document-edit-form.tsx:221
 *   apps/remix/app/components/general/template/template-edit-form.tsx:187
 */

declare function updateA(): Promise<void>;
declare function updateB(): Promise<void>;
declare function updateC(): Promise<void>;

// Returned to caller — caller awaits + handles errors.
export function batchUpdate(): Promise<unknown[]> {
  return Promise.all([updateA(), updateB(), updateC()]);
}

// Arrow function with implicit-return Promise.all body.
export const batchUpdateArrow = (): Promise<unknown[]> =>
  Promise.all([updateA(), updateB(), updateC()]);
