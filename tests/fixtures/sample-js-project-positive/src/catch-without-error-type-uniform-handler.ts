/**
 * Positive fixture for reliability/deterministic/catch-without-error-type.
 *
 * Both handlers below are uniform — they log + surface a generic user-facing
 * message + optionally rethrow. No branch in the body depends on the error
 * type, so demanding `instanceof` / `typeof` discrimination would not
 * change behaviour. Flagging these is noise.
 */

declare function toast(args: { title: string; description: string; variant: string }): void;

interface AppErrorShape {
  message: string;
}
declare const AppError: {
  parseError(err: unknown): AppErrorShape;
};

export async function removeAttachment(deleteAttachment: (a: { id: string }) => Promise<void>, id: string): Promise<void> {
  try {
    await deleteAttachment({ id });
    toast({ title: 'OK', description: 'Attachment removed.', variant: 'default' });
  } catch (err) {
    const parsed = AppError.parseError(err);
    toast({ title: 'Error', description: parsed.message, variant: 'destructive' });
  }
}

export async function submitSignature(payload: { id: string }, sign: (p: { id: string }) => Promise<void>): Promise<void> {
  try {
    await sign(payload);
  } catch (err) {
    console.error('Signature submission failed', err);
    toast({ title: 'Error', description: 'Signing failed.', variant: 'destructive' });
    throw err;
  }
}
