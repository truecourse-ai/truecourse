
type ParticipantWithClientId = { clientId: string; id?: number; email: string; name?: string; fields?: FieldDef[] };
type UpdatedParticipant = { clientId: string; id: number };
type FieldDef = { type: string; page: number; positionX: number; positionY: number };

declare function setParticipants(opts: { resourceId: string; participants: unknown[] }): Promise<{ participants: UpdatedParticipant[] }>;
declare class AppError extends Error { constructor(code: string, opts: { message: string }); }

async function processEmbeddedResourceUpdate(resourceId: string, participantsWithClientId: ParticipantWithClientId[]) {
  const { participants: updatedParticipants } = await setParticipants({
    resourceId,
    participants: participantsWithClientId.map((p) => ({
      id: p.id,
      clientId: p.clientId,
      email: p.email,
      name: p.name ?? '',
    })),
  });

  const fields = participantsWithClientId.flatMap((participant) => {
    const participantId = updatedParticipants.find((r) => r.clientId === participant.clientId)?.id;

    if (!participantId) {
      throw new AppError('UNKNOWN_ERROR', { message: 'Participant not found' });
    }

    return (participant.fields ?? []).map((field) => ({
      ...field,
      participantId,
      assigneeEmail: participant.email,
    }));
  });

  return fields;
}
