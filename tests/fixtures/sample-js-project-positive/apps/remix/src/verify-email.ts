
declare function verifyEmailToken(token: string): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleEmailVerification(token: string): Promise<void> {
  try {
    await verifyEmailToken(token);
    showToast({ title: 'Email verified', description: 'Your email has been successfully verified.' });
  } catch (err) {
    console.error(err);
    showToast({
      title: 'Verification failed',
      description: 'The verification link may have expired.',
      variant: 'destructive',
    });
  }
}
