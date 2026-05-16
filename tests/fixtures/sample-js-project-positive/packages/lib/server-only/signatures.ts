
// --- unknown-catch-variable shape: catch(error) instanceof AppError guard; non-AppError wrapped in new AppError ---
declare class AppError8 extends Error {
  constructor(code: string, opts?: { message?: string });
}
declare const AppErrorCode8: { UNKNOWN_ERROR: string };
declare function applySignatureToFields(
  fields: Array<{ id: string }>,
  signature: string,
  token: string,
): Promise<void>;

async function applyMultiSignSignature(
  fields: Array<{ id: string }>,
  signature: string,
  recipientToken: string,
) {
  try {
    await applySignatureToFields(fields, signature, recipientToken);
    return { success: true };
  } catch (error) {
    if (error instanceof AppError8) {
      throw error;
    }

    throw new AppError8(AppErrorCode8.UNKNOWN_ERROR, {
      message: 'Failed to apply multi-sign signature',
    });
  }
}
