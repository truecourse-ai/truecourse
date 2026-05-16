
// Error unused: catch(error) shows generic toast, error value is never dereferenced
async function submitTwoFactorCode(code: string): Promise<void> {
  try {
    await verifyTwoFactorCode(code);
  } catch (error) {
    showToast({ title: 'Authentication failed', description: 'Please check your code and try again.', variant: 'destructive' });
  }
}

declare function verifyTwoFactorCode(code: string): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant: string }): void;
