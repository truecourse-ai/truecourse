// get-multi-sign-document.ts — thin server adapter: validates input, calls service
// Line count inflated by type imports and schema boilerplate.

declare const z: {
  object: (shape: Record<string, unknown>) => ZodObjA;
  string: () => ZodStrA;
  number: () => ZodNumA;
  array: (s: unknown) => ZodArrA;
  optional: (s: unknown) => ZodOptA;
};
declare class ZodObjA { parse(v: unknown): unknown; }
declare class ZodStrA { parse(v: unknown): string; }
declare class ZodNumA { parse(v: unknown): number; }
declare class ZodArrA { parse(v: unknown): unknown[]; }
declare class ZodOptA { parse(v: unknown): unknown; }

declare const prisma: {
  envelope: {
    findMany: (opts: { where: Record<string, unknown>; include?: Record<string, unknown> }) => Promise<EmbedEnvelopeRecord[]>;
  };
};

type EmbedEnvelopeRecord = {
  id: number;
  title: string;
  status: string;
  createdAt: Date;
  recipients: Array<{ id: number; email: string; token: string; status: string }>;
};

type GetMultiSignDocumentInput = {
  documentIds: number[];
  embedToken: string;
  userId?: number;
};

type GetMultiSignDocumentOutput = {
  documents: EmbedEnvelopeRecord[];
  total: number;
};

const ZGetMultiSignDocumentInputSchema = z.object({
  documentIds: z.array(z.number()),
  embedToken: z.string(),
  userId: z.optional(z.number()),
});

declare function validateEmbedTokenForUser(token: string, userId?: number): Promise<boolean>;

export async function getMultiSignDocument(rawInput: unknown): Promise<GetMultiSignDocumentOutput> {
  const { documentIds, embedToken, userId } =
    ZGetMultiSignDocumentInputSchema.parse(rawInput) as GetMultiSignDocumentInput;

  const isValid = await validateEmbedTokenForUser(embedToken, userId);

  if (!isValid) {
    throw new Error('Invalid or expired embed token.');
  }

  const documents = await prisma.envelope.findMany({
    where: {
      id: { in: documentIds },
    },
    include: {
      recipients: true,
    },
  });

  return {
    documents,
    total: documents.length,
  };
}
