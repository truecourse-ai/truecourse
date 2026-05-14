
// --- inconsistent-return shape: async event handler (return value never consumed) ---
// Returns authClient.signOut() in try vs implicit undefined in catch.
// Return value is unconditionally discarded by the caller (onClick handler);
// mixed return in async event handlers is intentional.
declare const authClient: { signOut: () => Promise<void> };
declare function deleteAccount(): Promise<void>;

const onDeleteAccount = async (): Promise<void> => {
  try {
    await deleteAccount();
    showToast({ title: 'Account deleted', description: 'Your account has been removed.' });
    return await authClient.signOut();
  } catch {
    showToast({
      title: 'Something went wrong',
      description: 'We encountered an error while deleting your account. Please try again later.',
      variant: 'destructive',
    });
  }
};
