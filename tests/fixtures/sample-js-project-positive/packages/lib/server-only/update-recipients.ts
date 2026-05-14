
// Snippet: function call with object using nullish coalescing for optional field
declare function assignRecipients(opts: { userId: number; teamId?: number; recipients: unknown[] }): Promise<void>;
declare const apiToken: { userId: number; teamId: number | null };
declare const recipientList: unknown[];

export async function syncRecipients() {
  await assignRecipients({
    userId: apiToken.userId,
    teamId: apiToken.teamId ?? undefined,
    recipients: recipientList,
  });
}
