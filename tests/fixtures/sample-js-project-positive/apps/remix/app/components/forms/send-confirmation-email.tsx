
// [unknown-catch-variable] catch(err) — never used; only generic destructive toast shown
declare function resendConfirmationEmail(opts: { userId: string }): Promise<void>;
declare const userId: string;
declare const confirmationToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleResendConfirmation(): Promise<void> {
  try {
    await resendConfirmationEmail({ userId });
    confirmationToast({ title: 'Email sent', description: 'A confirmation email has been sent to your inbox.' });
  } catch (err) {
    confirmationToast({
      title: 'Failed to send email',
      description: 'An error occurred while sending the confirmation email. Please try again.',
      variant: 'destructive',
    });
  }
}
