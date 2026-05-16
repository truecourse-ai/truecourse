
// --- unknown-catch-variable shape: catch(err) logger.warn with err as named object field ---
declare const ctxLogger: { warn(ctx: Record<string, unknown>, msg: string): void };
declare function deleteEnvelope(opts: { id: string; userId: string; teamId?: string }): Promise<void>;

async function bulkDeleteEnvelopes(
  envelopeIds: string[],
  userId: string,
  teamId: string | undefined,
): Promise<{ success: boolean; envelopeId: string }[]> {
  return Promise.all(
    envelopeIds.map(async (envelopeId) => {
      try {
        await deleteEnvelope({ id: envelopeId, userId, teamId });
        return { success: true, envelopeId };
      } catch (err) {
        ctxLogger.warn(
          {
            envelopeId,
            error: err,
          },
          'Failed to delete envelope during bulk delete',
        );

        return { success: false, envelopeId };
      }
    }),
  );
}



// --- unknown-catch-variable shape: catch(error) instanceof TRPCError guard; re-wrap unknown errors ---
declare class TRPCError extends Error {
  constructor(opts: { code: string; message?: string });
}
declare function sendTwoFactorEmail(opts: { token: string; envelopeId: string }): Promise<void>;
declare function generateOtpToken(): string;

async function requestTwoFactorEmail(envelopeId: string) {
  try {
    const token = generateOtpToken();

    await sendTwoFactorEmail({ token, envelopeId });

    return { success: true };
  } catch (error) {
    console.error('Error sending 2FA email:', error);

    if (error instanceof TRPCError) {
      throw error;
    }

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to send two-factor authentication email',
    });
  }
}



declare const AppError: { parseError: (e: unknown) => { code: string; message: string } };
declare const AppErrorCode: { ALREADY_EXISTS: string; UNAUTHORIZED: string };
declare function addDomainRecord(domain: string, orgId: string): Promise<{ records: string[] }>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleDomainAdd(domain: string, orgId: string): Promise<void> {
  try {
    const result = await addDomainRecord(domain, orgId);
    showToast({ title: 'Domain Added', description: 'DNS records generated.' });
  } catch (err) {
    const error = AppError.parseError(err);
    console.error(error);

    if (error.code === AppErrorCode.ALREADY_EXISTS) {
      showToast({
        title: 'Domain already in use',
        description: 'Please try a different domain.',
        variant: 'destructive',
      });
    } else {
      showToast({
        title: 'An unknown error occurred',
        description: 'We encountered an unknown error. Please try again later.',
        variant: 'destructive',
      });
    }
  }
}
