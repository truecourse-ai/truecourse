declare const db: {
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};
declare function upsertRecipient(tx: unknown, envelopeId: string, email: string, role: string): Promise<{ id: string }>;

export async function updateEnvelopeRecipients(
  envelopeId: string,
  recipients: Array<{ email: string; role: string }>,
) {
  return db.$transaction(async (tx) => {
    const results = await Promise.all(
      recipients.map((r) => upsertRecipient(tx, envelopeId, r.email, r.role)),
    );
    return results;
  });
}
