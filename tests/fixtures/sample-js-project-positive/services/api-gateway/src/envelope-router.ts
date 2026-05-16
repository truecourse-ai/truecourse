
// shape: ts-pattern .with() async callback delegates to setDocumentRecipients returning a Promise; async for match callback type conformance
declare function setDocumentRecipients(opts: { userId: string; teamId: string; envelopeId: string; recipients: unknown[] }): Promise<{ recipients: unknown[] }>;
declare const EnvelopeType: { DOCUMENT: 'DOCUMENT'; TEMPLATE: 'TEMPLATE' };
declare const envelopeType: 'DOCUMENT' | 'TEMPLATE';
declare const match: (val: unknown) => { with(pattern: unknown, cb: () => Promise<unknown>): { exhaustive(): Promise<unknown> } };

const updateRecipients = async (userId: string, teamId: string, envelopeId: string, recipients: unknown[]) => {
  const { recipients: updatedRecipients } = await match(envelopeType)
    .with(EnvelopeType.DOCUMENT, async () =>
      setDocumentRecipients({
        userId,
        teamId,
        envelopeId,
        recipients,
      }),
    )
    .exhaustive();

  return updatedRecipients;
};



// shape: ts-pattern .with() async callback delegates to deleteDocument returning a Promise; async for match callback type conformance
declare function deleteDocument(opts: { userId: string; teamId: string; envelopeId: string }): Promise<void>;
declare function deleteTemplate(opts: { userId: string; teamId: string; envelopeId: string }): Promise<void>;
declare const EnvelopeVariant: { DOCUMENT: 'DOCUMENT'; TEMPLATE: 'TEMPLATE' };
declare const envelopeVariant: 'DOCUMENT' | 'TEMPLATE';
declare const matchVariant: (val: unknown) => {
  with(pattern: unknown, cb: () => Promise<void>): {
    with(pattern: unknown, cb: () => Promise<void>): { exhaustive(): Promise<void> }
  }
};

const removeEnvelope = async (userId: string, teamId: string, envelopeId: string) => {
  await matchVariant(envelopeVariant)
    .with(EnvelopeVariant.DOCUMENT, async () =>
      deleteDocument({ userId, teamId, envelopeId }),
    )
    .with(EnvelopeVariant.TEMPLATE, async () =>
      deleteTemplate({ userId, teamId, envelopeId }),
    )
    .exhaustive();
};



declare const logger: { warn: (obj: object, msg: string) => void };
declare function processItem(id: string): Promise<void>;

async function bulkDeleteItems(itemIds: string[]): Promise<{ success: boolean; itemId: string }[]> {
  return Promise.all(
    itemIds.map(async (itemId) => {
      try {
        await processItem(itemId);
        return { success: true, itemId };
      } catch (err) {
        logger.warn(
          {
            itemId,
            error: err,
          },
          'Failed to delete item during bulk delete',
        );
        return { success: false, itemId };
      }
    }),
  );
}


// Promise.all with async map over recipients — valid async map, no type mismatch
declare function sendCancellationEmail(args: { recipientId: number; recipientEmail: string; documentTitle: string }): Promise<void>;

async function notifyRecipientsOfCancellation(
  recipients: Array<{ id: number; email: string }>,
  documentTitle: string,
): Promise<void> {
  await Promise.all(
    recipients.map(async (recipient) =>
      sendCancellationEmail({
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        documentTitle,
      }),
    ),
  );
}

