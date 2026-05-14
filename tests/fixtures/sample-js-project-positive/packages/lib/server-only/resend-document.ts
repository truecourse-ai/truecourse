declare function fetchPendingRecipients(docId: string): Promise<Array<{ id: string; email: string }>>;
declare function sendSigningReminder(recipientId: string): Promise<void>;

export async function resendDocument(docId: string) {
  const recipients = await fetchPendingRecipients(docId);
  await Promise.all(
    recipients.map((r) => sendSigningReminder(r.id)),
  );
}
