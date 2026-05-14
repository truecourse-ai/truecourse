
// FP: prisma.envelope.findFirstOrThrow references an imported prisma client — hoisted import.
declare const prisma: { 
  envelope: { 
    findFirstOrThrow: (q: unknown) => Promise<{ id: string; type: string; status: string }> 
  } 
};

type GetEnvelopeByTokenOptions = { token: string };

export async function getEnvelopeByToken({ token }: GetEnvelopeByTokenOptions) {
  if (!token) {
    throw new Error('Missing access token');
  }

  return await prisma.envelope.findFirstOrThrow({
    where: {
      recipients: {
        some: { token },
      },
    },
  });
}
