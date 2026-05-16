
// tx.field.createMany already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  field: { createMany(args: { data: unknown[] }): Promise<{ count: number }> };
  recipient: { create(args: { data: unknown }): Promise<{ id: number }> };
};

export async function createRecipientWithFields(
  envelopeId: string,
  recipientData: unknown,
  fieldData: unknown[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const recipient = await tx.recipient.create({ data: recipientData });
    await tx.field.createMany({
      data: fieldData.map((f) => ({ ...(f as object), recipientId: recipient.id, envelopeId })),
    });
  });
}


// createEnvelope({userId: user.id, teamId, ...}) FP — createEnvelope undefined → TS2304 → rule fires
export async function createUserEnvelope_5e8dc309(title: string, type: string): Promise<{ id: string }> {
  return createEnvelope({
    userId: currentUser.id,
    teamId: currentTeamId,
    title,
    type,
    visibility: EnvelopeVisibility.TEAM,
  });
}

