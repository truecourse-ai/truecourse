declare const AppError: new (code: string, opts?: { message?: string }) => Error;
declare const AppErrorCode: { INVALID_REQUEST: string; UNAUTHORIZED: string };
declare function getDocumentByToken(opts: { token: string }): Promise<{ id: number; authOptions: unknown }>;
declare function getRecipientByToken(opts: { token: string }): Promise<{ id: number; readStatus: string; authOptions: unknown }>;
declare function signFieldWithToken(opts: { token: string; fieldId: number; value: string; isBase64?: boolean }): Promise<void>;
declare function extractDocumentAuthMethods(opts: { documentAuth: unknown; recipientAuth: unknown }): { recipientAccessAuthRequired: boolean; recipientActionAuthRequired: boolean };
declare const prisma: { recipient: { update: (q: unknown) => Promise<unknown> }; field: { findMany: (q: unknown) => Promise<{ id: number; type: string; customText: string }[]> } };
declare const procedure: { input: (s: unknown) => unknown };
declare const ZApplyBulkSignatureRequestSchema: unknown;
declare const ZApplyBulkSignatureResponseSchema: unknown;

export const applyBulkSignatureRoute = (procedure as any)
  .input(ZApplyBulkSignatureRequestSchema)
  .output(ZApplyBulkSignatureResponseSchema)
  .mutation(async ({ input }: { input: { tokens: string[]; signature: string; isBase64?: boolean } }) => {
    const { tokens, signature, isBase64 } = input;

    const envelopes = await Promise.all(
      tokens.map(async (token) => {
        const document = await getDocumentByToken({ token });
        const recipient = await getRecipientByToken({ token });
        return { document, recipient, token };
      }),
    );

    const hasUnviewedDocuments = envelopes.some((e) => e.recipient.readStatus !== 'OPENED');

    if (hasUnviewedDocuments) {
      throw new AppError(AppErrorCode.INVALID_REQUEST, {
        message: 'All documents must be viewed before signing',
      });
    }

    for (const envelope of envelopes) {
      const authMethods = extractDocumentAuthMethods({
        documentAuth: envelope.document.authOptions,
        recipientAuth: envelope.recipient.authOptions,
      });

      if (authMethods.recipientAccessAuthRequired || authMethods.recipientActionAuthRequired) {
        throw new AppError(AppErrorCode.UNAUTHORIZED, {
          message: 'Action auth is required and not supported for bulk signing',
        });
      }
    }

    for (const envelope of envelopes) {
      const fields = await prisma.field.findMany({
        where: { recipientId: envelope.recipient.id, type: 'SIGNATURE' },
      });

      for (const field of fields) {
        await signFieldWithToken({
          token: envelope.token,
          fieldId: field.id,
          value: signature,
          isBase64,
        });
      }

      await prisma.recipient.update({
        where: { id: envelope.recipient.id },
        data: { signingStatus: 'SIGNED', signedAt: new Date() },
      });
    }

    return { success: true, signed: envelopes.length };
  });
