
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

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
