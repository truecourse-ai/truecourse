
declare const notificationJobs: { triggerJob: (opts: { name: string; payload: unknown }) => Promise<void> };
declare function getUpdatedParticipants(envelopeId: string): Promise<{ id: string; email: string; role: string; sendStatus: string }[]>;

export async function notifyUpdatedParticipants(envelopeId: string, documentId: string, userId: string): Promise<void> {
  const participants = await getUpdatedParticipants(envelopeId);

  const toNotify = participants.filter((p) => p.sendStatus !== 'SENT' && p.role !== 'CC');

  await Promise.all(
    toNotify.map(async (participant) => {
      await notificationJobs.triggerJob({
        name: 'send.participant.updated.email',
        payload: {
          userId,
          documentId,
          participantId: participant.id,
        },
      });
    }),
  );
}
