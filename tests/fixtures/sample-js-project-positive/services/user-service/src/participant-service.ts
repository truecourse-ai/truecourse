// prisma.$transaction with nested async map via Promise.all
declare const prisma: {
  $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

declare const linkedParticipants: Array<{
  id?: number;
  email: string;
  role: string;
  formId: string;
}>;

export async function persistParticipants() {
  const results = await prisma.$transaction(async (tx) => {
    return await Promise.all(
      linkedParticipants.map(async (participant) => {
        const upserted = await tx.participant.upsert({
          where: { id: participant.id ?? -1 },
          create: {
            email: participant.email,
            role: participant.role,
            formId: participant.formId,
          },
          update: {
            email: participant.email,
            role: participant.role,
          },
        });

        return upserted;
      }),
    );
  });

  return results;
}
