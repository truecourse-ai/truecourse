
declare const jobs: { triggerJob: (opts: { name: string; payload: unknown }) => Promise<void> };
declare function extractRecipients(doc: { recipients: { id: string; sendStatus: string; role: string }[] }): { id: string; sendStatus: string; role: string }[];

export async function dispatchSigningEmails(documentId: string, userId: string, recipients: { id: string; sendStatus: string; role: string }[]): Promise<void> {
  const pendingRecipients = recipients.filter((r) => r.sendStatus !== 'SENT' && r.role !== 'CC');

  await Promise.all(
    pendingRecipients.map(async (recipient) => {
      await jobs.triggerJob({
        name: 'send.signing.requested.email',
        payload: {
          userId,
          documentId,
          recipientId: recipient.id,
        },
      });
    }),
  );
}



declare const txDb: { $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> };
declare function buildSigningOrder(recipients: { id: string; role: string; signingOrder?: number }[]): { id: string; role: string; signingOrder?: number }[];

export async function processDocumentDispatch(envelopeId: string, recipients: { id: string; role: string; signingOrder?: number }[]): Promise<void> {
  const orderedRecipients = buildSigningOrder(recipients);

  await txDb.$transaction(async (tx) => {
    await Promise.all(
      orderedRecipients.map(async (recipient) => {
        await (tx as any).dispatchLog.create({
          data: {
            envelopeId,
            recipientId: recipient.id,
            status: 'PENDING',
          },
        });
      }),
    );
  });
}



declare function getRecipientsForDispatch(envelopeId: string): Promise<{ id: string; email: string; role: string }[]>;
declare const dispatchJobs: { triggerJob: (opts: { name: string; payload: unknown }) => Promise<void> };

export async function scheduleSigningEmails(envelopeId: string, documentId: string, requesterId: string): Promise<void> {
  const recipients = await getRecipientsForDispatch(envelopeId);

  const eligibleRecipients = recipients.filter((r) => r.role !== 'CC');

  await Promise.all(
    eligibleRecipients.map(async (recipient) => {
      await dispatchJobs.triggerJob({
        name: 'send.signing.email',
        payload: {
          requesterId,
          documentId,
          recipientId: recipient.id,
        },
      });
    }),
  );
}
