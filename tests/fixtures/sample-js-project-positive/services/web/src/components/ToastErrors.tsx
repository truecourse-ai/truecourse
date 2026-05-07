/**
 * Toast notifications use a short generic title paired with a specific
 * `description` that explains the actual failure. The
 * generic-error-message rule must NOT fire on the title when a sibling
 * `description` (or `detail`/`details`/`message`/`cause`) field
 * provides the actionable detail.
 *
 * Mirrors documenso's
 *   apps/remix/app/components/dialogs/document-resend-dialog.tsx:110-114
 *   apps/remix/app/components/dialogs/admin-organisation-member-delete-dialog.tsx
 *   apps/remix/app/components/dialogs/envelope-distribute-dialog.tsx
 * (~50 dialogs total) where the rule produced ~70 false positives on
 * the canonical title+description toast pattern.
 */

interface ToastOptions {
  readonly title: string;
  readonly description: string;
  readonly variant?: 'destructive' | 'default';
}

declare function toast(options: ToastOptions): void;

export function notifyResendFailure(): void {
  toast({
    title: 'Something went wrong',
    description: 'This document could not be re-sent at this time. Please try again.',
    variant: 'destructive',
  });
}

export function notifyDeleteFailure(): void {
  toast({
    title: 'An error occurred',
    description: "We couldn't remove this member from the organisation. Refresh and retry.",
    variant: 'destructive',
  });
}

export function notifyDistributeFailure(): void {
  toast({
    title: 'Oops',
    description: 'The envelope could not be distributed to all recipients. Please contact support.',
  });
}
