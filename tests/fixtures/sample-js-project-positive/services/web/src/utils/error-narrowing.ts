/**
 * Project-specific error-narrowing helpers. The catch-without-error-type
 * rule must NOT fire when the body's first action is to assign a
 * narrowed error to a new local via a function call passing the
 * catch parameter.
 *
 *   } catch (err) {
 *     const error = AppError.parseError(err);   // <-- narrowing helper
 *     console.error(error);
 *     toast({ title: error.code, ... });
 *   }
 *
 * `parseError` (and equivalents like `normalizeError`, `toAppError`,
 * `fromUnknown`) inspects `err`, walks `instanceof` checks
 * internally, and returns a typed wrapper. The rule's textual
 * `instanceof`/`typeof` heuristic doesn't see this — but the
 * "catch param passed to a call whose return is bound to a new
 * local" shape is a reliable signal that narrowing is happening.
 *
 * Mirrors documenso's
 *   apps/remix/app/components/dialogs/admin-organisation-create-dialog.tsx:86-92
 *   apps/remix/app/components/dialogs/document-move-to-folder-dialog.tsx
 *   apps/remix/app/components/dialogs/admin-swap-subscription-dialog.tsx
 *   (~50 dialog handlers using AppError.parseError)
 */

import { AppError } from '../../../user-service/src/errors/app-error';

declare function toast(opts: { readonly title: string; readonly description: string }): void;

export async function deleteOrganisation(orgId: string, doDelete: () => Promise<void>): Promise<void> {
  try {
    await doDelete();
    toast({ title: 'Deleted', description: `Removed organisation ${orgId}` });
  } catch (err: unknown) {
    const error = AppError.parseError(err);
    console.error('delete failed:', error);
    toast({
      title: 'An unknown error occurred',
      description: error.message,
    });
  }
}

export async function moveDocument(docId: string, doMove: () => Promise<void>): Promise<void> {
  try {
    await doMove();
  } catch (err: unknown) {
    const appError = AppError.parseError(err);
    console.warn('move failed:', appError);
    toast({ title: 'Move failed', description: appError.message });
  }
}
