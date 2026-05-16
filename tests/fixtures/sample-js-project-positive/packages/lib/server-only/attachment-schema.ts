
declare const z: {
  object: (shape: Record<string, unknown>) => { merge: (s: unknown) => unknown };
  string: () => { min: (n: number) => unknown; optional: () => unknown; url: () => unknown };
  number: () => { int: () => unknown };
};
declare function authenticatedProcedure(): { input: (s: unknown) => { output: (s: unknown) => { mutation: (fn: unknown) => unknown } } };

const ZUploadAttachmentRequestSchema = z.object({
  documentId: z.number().int(),
  label: z.string().min(1),
  sourceUrl: z.string().url(),
});

const ZUploadAttachmentResponseSchema = z.object({
  id: z.number().int(),
  label: z.string().min(1),
});

const uploadAttachmentRoute = authenticatedProcedure()
  .input(ZUploadAttachmentRequestSchema)
  .output(ZUploadAttachmentResponseSchema)
  .mutation(async ({ input, ctx }: { input: { documentId: number; label: string; sourceUrl: string }; ctx: { userId: number } }) => {
    const { documentId, label, sourceUrl } = input;
    return { id: 1, label };
  });
