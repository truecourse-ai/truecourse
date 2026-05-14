// updateEmbeddingContractRoute — thin-server tRPC mutation FP shape
declare const AppError_embed: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode_embed: { UNAUTHORIZED: string; NOT_FOUND: string };
declare const verifyEmbedPresignToken_embed: (opts: { token: string; scope: string }) => Promise<{ userId: number; teamId: number | null }>;
declare const updateContract_embed: (opts: { userId: number; teamId?: number; id: { type: string; id: number }; data: { title?: string; externalId?: string }; meta?: unknown; requestMetadata?: unknown }) => Promise<void>;
declare const setFieldsForContract_embed: (opts: { userId: number; teamId?: number; id: { type: string; id: number }; fields: unknown[] }) => Promise<{ fields: Array<{ id: number; recipientId: number | null }> }>;
declare const setContractRecipients_embed: (opts: { userId: number; teamId?: number; id: { type: string; id: number }; recipients: unknown[] }) => Promise<{ recipients: Array<{ id: number; clientId: string }> }>;
declare const nanoid_embed: () => string;
declare const procedure_embed: {
  input: (schema: unknown) => {
    output: (schema: unknown) => {
      mutation: (fn: (opts: { input: unknown; ctx: { logger: { info: (v: unknown) => void }; req: { headers: { get: (k: string) => string | null } }; metadata: unknown } }) => Promise<unknown>) => unknown;
    };
  };
};
declare const ZUpdateEmbeddingContractRequestSchema_embed: unknown;
declare const ZUpdateEmbeddingContractResponseSchema_embed: unknown;

export const updateEmbeddingContractRoute = procedure_embed
  .input(ZUpdateEmbeddingContractRequestSchema_embed)
  .output(ZUpdateEmbeddingContractResponseSchema_embed)
  .mutation(async ({ input, ctx }) => {
    const typedInput = input as {
      documentId: number;
      title?: string;
      externalId?: string;
      recipients: Array<{ id?: number; name: string; email: string; role: string; clientId?: string }>;
      fields: Array<{ recipientClientId?: string; type: string; pageNumber: number; pageX: number; pageY: number; pageWidth: number; pageHeight: number }>;
      meta?: unknown;
    };

    ctx.logger.info({ input: { documentId: typedInput.documentId } });

    try {
      const authHeader = ctx.req.headers.get('authorization');
      const [presignToken] = (authHeader || '').split('Bearer ').filter((s) => s.length > 0);

      if (!presignToken) {
        throw new AppError_embed(AppErrorCode_embed.UNAUTHORIZED, {
          message: 'No presign token provided',
        });
      }

      const apiToken = await verifyEmbedPresignToken_embed({
        token: presignToken,
        scope: `documentId:${typedInput.documentId}`,
      });

      const { documentId, title, externalId, recipients, fields, meta } = typedInput;

      await updateContract_embed({
        userId: apiToken.userId,
        teamId: apiToken.teamId ?? undefined,
        id: { type: 'documentId', id: documentId },
        data: { title, externalId },
        meta,
        requestMetadata: ctx.metadata,
      });

      const recipientsWithClientId = recipients.map((r) => ({ ...r, clientId: r.clientId ?? nanoid_embed() }));

      const { recipients: updatedRecipients } = await setContractRecipients_embed({
        userId: apiToken.userId,
        teamId: apiToken.teamId ?? undefined,
        id: { type: 'documentId', id: documentId },
        recipients: recipientsWithClientId.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role,
          clientId: r.clientId,
        })),
      });

      const clientIdToRecipientIdMap = new Map(
        updatedRecipients.map((r) => [r.clientId, r.id]),
      );

      const mappedFields = fields.map((f) => ({
        ...f,
        recipientId: f.recipientClientId ? (clientIdToRecipientIdMap.get(f.recipientClientId) ?? null) : null,
      }));

      const { fields: updatedFields } = await setFieldsForContract_embed({
        userId: apiToken.userId,
        teamId: apiToken.teamId ?? undefined,
        id: { type: 'documentId', id: documentId },
        fields: mappedFields,
      });

      return { recipients: updatedRecipients, fields: updatedFields };
    } catch (err) {
      if (err instanceof Error && err.constructor.name === 'AppError') {
        throw err;
      }
      throw new AppError_embed(AppErrorCode_embed.NOT_FOUND, { message: 'Unexpected error updating contract' });
    }
  });
