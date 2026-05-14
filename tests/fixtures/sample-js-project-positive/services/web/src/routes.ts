
declare function unlinkOAuthProvider(provider: string): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleUnlinkAccount(provider: string): Promise<void> {
  try {
    await unlinkOAuthProvider(provider);
    showToast({ title: 'Account unlinked', description: 'The linked account has been removed.' });
  } catch (error) {
    console.error(error);
    showToast({
      title: 'Failed to unlink',
      description: 'An error occurred while unlinking the account.',
      variant: 'destructive',
    });
  }
}
