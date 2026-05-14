
// --- unknown-catch-variable shape: catch(error) console.error with prefix and value + re-throw ---
declare function deactivateUserAccount(userId: string): Promise<void>;
declare function expirePasswordResetTokens(userId: string): Promise<void>;
declare function revokePasskeys(userId: string): Promise<void>;

async function disableUser(userId: string) {
  try {
    await deactivateUserAccount(userId);
    await expirePasswordResetTokens(userId);
    await revokePasskeys(userId);
  } catch (error) {
    console.error('Error disabling user', error);
    throw error;
  }
}
