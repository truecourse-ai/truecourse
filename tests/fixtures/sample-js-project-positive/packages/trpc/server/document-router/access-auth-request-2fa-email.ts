
declare const prisma6: { envelope: { findFirst: (opts: unknown) => Promise<{ recipients: Array<{ token: string; authOptions: unknown }> } & { authOptions: unknown } | null> } };
declare const request2FAEmailRateLimit2: { check: (opts: { ip: string; identifier: string }) => Promise<unknown> };
declare const assertRateLimit2: (result: unknown) => void;
declare const extractDocumentAuthMethods2: (opts: { documentAuth: unknown; recipientAuth: unknown }) => { derivedRecipientAccessAuth: string[] };
declare const DocumentAuth2: { TWO_FACTOR_AUTH: string };
declare const EnvelopeType2: { DOCUMENT: string };
declare const TRPCError2: new (opts: { code: string; message: string }) => Error;
declare const procedure2: { input: (schema: unknown) => { output: (schema: unknown) => { mutation: (fn: (opts: { input: unknown; ctx: { user: { id: number }; metadata: { requestMetadata: { ipAddress?: string } } } }) => Promise<unknown>) => unknown } } };
declare const ZAccessAuthRequest2FAEmailRequestSchema2: unknown;
declare const ZAccessAuthRequest2FAEmailResponseSchema2: unknown;

export const accessAuthRequest2FAEmailRoute2 = procedure2
  .input(ZAccessAuthRequest2FAEmailRequestSchema2)
  .output(ZAccessAuthRequest2FAEmailResponseSchema2)
  .mutation(async ({ input, ctx }) => {
    try {
      const { token } = input as { token: string };

      const rateLimitResult = await request2FAEmailRateLimit2.check({
        ip: ctx.metadata.requestMetadata.ipAddress ?? 'unknown',
        identifier: token,
      });

      assertRateLimit2(rateLimitResult);

      const envelope = await prisma6.envelope.findFirst({
        where: {
          type: EnvelopeType2.DOCUMENT,
          recipients: {
            some: {
              token,
            },
          },
        },
        include: {
          recipients: {
            where: {
              token,
            },
          },
        },
      } as unknown as Parameters<typeof prisma6.envelope.findFirst>[0]);

      if (!envelope) {
        throw new TRPCError2({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }

      const [recipient] = (envelope as unknown as { recipients: Array<{ token: string; authOptions: unknown }> }).recipients;

      const { derivedRecipientAccessAuth } = extractDocumentAuthMethods2({
        documentAuth: (envelope as unknown as { authOptions: unknown }).authOptions,
        recipientAuth: recipient.authOptions,
      });

      if (!derivedRecipientAccessAuth.includes(DocumentAuth2.TWO_FACTOR_AUTH)) {
        throw new TRPCError2({
          code: 'BAD_REQUEST',
          message: '2FA is not required for this document',
        });
      }

      return { success: true };
    } catch (err) {
      if (err instanceof TRPCError2) throw err;
      throw new TRPCError2({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error' });
    }
  });
