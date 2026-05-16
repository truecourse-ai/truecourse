
// AppError.parseError normalization: first statement safely normalizes catch param
declare const TypedErrorParser: { parseError(e: unknown): { code: string; message: string } };
declare function showNotification(opts: { title: string; variant: string }): void;
declare function claimUserAccount(inviteToken: string): Promise<void>;

async function handleClaimAccount(token: string): Promise<void> {
  try {
    await claimUserAccount(token);
  } catch (err) {
    const error = TypedErrorParser.parseError(err);
    showNotification({ title: error.message, variant: 'destructive' });
  }
}
