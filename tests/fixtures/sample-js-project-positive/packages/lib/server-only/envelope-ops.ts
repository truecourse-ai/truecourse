
// tx.recipient.createMany already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  recipient: { createMany(args: { data: unknown[] }): Promise<{ count: number }> };
  envelope: { update(args: { where: { id: string }; data: unknown }): Promise<{ id: string }> };
};

export async function createEnvelopeWithRecipients(
  envelopeId: string,
  recipientEmails: string[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.recipient.createMany({
      data: recipientEmails.map((email) => ({ envelopeId, email, token: Math.random().toString(36) })),
    });
    await tx.envelope.update({
      where: { id: envelopeId },
      data: { status: 'PENDING' },
    });
  });
}


// createTRPCClient<AppRouter>({ links: [splitLink({...})] }) FP — createTRPCClient undefined → TS2304 → rule fires
export const analyticsClient_bfc35c6f = createTRPCClient({
  links: [
    splitLink({
      condition: (op: { type: string }) => op.type === 'subscription',
      true: wsLink({ client: createWSClient({ url: 'ws://localhost:4001' }) }),
      false: httpBatchLink({ url: '/api/analytics/trpc' }),
    }),
  ],
});

