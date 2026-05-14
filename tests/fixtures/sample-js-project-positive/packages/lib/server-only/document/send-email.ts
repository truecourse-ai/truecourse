
// FP shape: async function body with single await db call (not complex)
declare const db: {
  envelope: {
    findUnique: (opts: {
      where: { id: string };
      include: { recipients: boolean; documentMeta: boolean };
    }) => Promise<{ id: string; recipients: Array<{ email: string }>; documentMeta: { subject?: string } | null } | null>;
  };
};

export const sendCompletedNotification = async ({ id, requestMetadata }: { id: string; requestMetadata?: Record<string, string> }) => {
  const envelope = await db.envelope.findUnique({
    where: { id },
    include: { recipients: true, documentMeta: true },
  });

  if (!envelope) return;

  for (const recipient of envelope.recipients) {
    console.log('sending to', recipient.email);
  }
};
