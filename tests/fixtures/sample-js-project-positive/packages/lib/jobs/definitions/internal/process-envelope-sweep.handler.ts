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
