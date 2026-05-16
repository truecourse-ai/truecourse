
// FP: tx.recipient.create inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function generateToken(): string;

export async function disableUserAndReassignDocs(
  userId: number,
  reassignToId: number,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { disabled: true },
    });

    await tx.apiToken.updateMany({
      where: { userId },
      data: { expires: new Date() },
    });

    await tx.recipient.create({
      data: {
        envelopeId: 0,
        email: 'disabled@example.com',
        name: 'Disabled User',
        token: generateToken(),
      },
    });
  });
}


// setTemplateRecipients({userId: apiToken.userId, teamId: apiToken.teamId ?? undefined}) FP — setTemplateRecipients undefined → TS2304 → rule fires
export async function syncContactAssignment_57c52a18(): Promise<void> {
  await setTemplateRecipients({
    userId: apiCredential.userId,
    teamId: apiCredential.teamId ?? undefined,
    contacts: contactList,
  });
}

