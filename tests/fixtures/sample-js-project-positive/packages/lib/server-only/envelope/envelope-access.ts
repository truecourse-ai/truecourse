
// FP shape: async function with destructured params (standard typed parameter destructuring)
declare const db: {
  envelope: {
    findFirst: (opts: { where: Record<string, unknown> }) => Promise<{ id: string; userId: string; teamId: number } | null>;
  };
};

type EnvelopeAccessOptions = {
  id: string;
  userId: string;
  teamId: number;
  type: 'DOCUMENT' | 'TEMPLATE' | null;
};

export const getEnvelopeAccessQuery = async ({ id, userId, teamId, type }: EnvelopeAccessOptions) => {
  if (!id || !userId || !teamId) {
    throw new Error('Missing required parameters');
  }

  const envelope = await db.envelope.findFirst({
    where: { id, userId },
  });

  return envelope;
};
