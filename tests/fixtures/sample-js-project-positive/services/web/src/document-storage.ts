
declare function downloadAuditLog(documentId: string): Promise<Blob>;
declare function triggerBrowserDownload(blob: Blob, filename: string): void;

async function handleAuditLogDownload(documentId: string): Promise<void> {
  try {
    const blob = await downloadAuditLog(documentId);
    triggerBrowserDownload(blob, `audit-log-${documentId}.csv`);
  } catch (error) {
    console.error(error);
  }
}



declare const AppError: { parseError: (e: unknown) => { code: string } };
declare function verify2FACode(userId: string, code: string): Promise<boolean>;
declare function setSubmitting(v: boolean): void;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handle2FASubmit(userId: string, code: string): Promise<void> {
  setSubmitting(true);
  try {
    await verify2FACode(userId, code);
  } catch (err) {
    setSubmitting(false);
    const error = AppError.parseError(err);
    showToast({ title: 'Verification failed', description: error.code, variant: 'destructive' });
  } finally {
    setSubmitting(false);
  }
}



declare function submitDocumentSignature(documentId: string, fieldValues: Record<string, string>): Promise<void>;
declare function onDocumentError(err: unknown): void;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleMultiSignSubmit(documentId: string, fieldValues: Record<string, string>): Promise<void> {
  try {
    await submitDocumentSignature(documentId, fieldValues);
  } catch (err) {
    onDocumentError(err);
    showToast({
      title: 'Signing failed',
      description: 'An error occurred while signing the document.',
      variant: 'destructive',
    });
  }
}



declare function resendVerificationEmail(userId: string): Promise<void>;
declare function setBannerLoading(v: boolean): void;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleResendVerification(userId: string): Promise<void> {
  setBannerLoading(true);
  try {
    await resendVerificationEmail(userId);
    showToast({ title: 'Email sent', description: 'A new verification email has been sent.' });
  } catch (err) {
    setBannerLoading(false);
    showToast({
      title: 'Failed to send',
      description: 'Could not send verification email. Please try again.',
      variant: 'destructive',
    });
  } finally {
    setBannerLoading(false);
  }
}



declare function submitDocumentSigningForm(documentId: string, recipientToken: string): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleSigningFormSubmit(documentId: string, recipientToken: string): Promise<void> {
  try {
    await submitDocumentSigningForm(documentId, recipientToken);
  } catch (err) {
    showToast({
      title: 'Error',
      description: 'An error occurred while submitting the signing form.',
      variant: 'destructive',
    });
  }
}
