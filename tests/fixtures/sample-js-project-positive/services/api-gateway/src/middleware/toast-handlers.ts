
// --- generic-error-message shape: toast-title-plus-specific-description ---
// The generic title is a deliberate short UI heading; the description field
// carries the specific, actionable message — no information is lost.
declare function showToast(opts: { title: string; description: string; variant?: string }): void;
declare function requestTwoFactorCode(userId: string): Promise<void>;

async function handle2faRequest(userId: string): Promise<void> {
  try {
    await requestTwoFactorCode(userId);
    showToast({ title: 'Code sent', description: 'Check your authenticator app for the verification code.' });
  } catch {
    showToast({
      title: 'An error occurred',
      description: 'We were unable to send your two-factor authentication code. Please try again.',
      variant: 'destructive',
    });
  }
}
