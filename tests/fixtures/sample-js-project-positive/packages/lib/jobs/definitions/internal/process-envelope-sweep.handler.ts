// Single handler selects specific columns — standalone usage, no meaningful extraction
declare const db: {
  envelope: {
    findMany(args: {
      where: { status: string };
      select: { id: boolean; externalId: boolean; status: boolean };
    }): Promise<Array<{ id: string; externalId: string; status: string }>>;
  };
};

async function processEnvelopeSweep() {
  const envelopes = await db.envelope.findMany({
    where: { status: 'PENDING_PROCESSING' },
    select: { id: true, externalId: true, status: true },
  });
  return envelopes;
}


// Promise.allSettled with async map — valid async map of job triggers, no type mismatch
interface ExpiredAccessToken { id: string; recipientId: string; }
declare const jobDispatcher: { triggerJob: (opts: { name: string; payload: object }) => Promise<void> };

async function sweepExpiredAccessTokens(tokens: ExpiredAccessToken[]): Promise<void> {
  await Promise.allSettled(
    tokens.map(async (token) => {
      await jobDispatcher.triggerJob({
        name: 'internal.revoke-expired-token',
        payload: { tokenId: token.id, recipientId: token.recipientId },
      });
    }),
  );
}

