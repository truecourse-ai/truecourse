
declare const db: { $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> };
declare function createAuthOptions(opts: { accessAuth: string[]; actionAuth: string[] }): unknown;

type NewRecipient = { name: string; email: string; role: string; signingOrder?: number; accessAuth?: string[]; actionAuth?: string[] };

export async function addEnvelopeParticipants(envelopeId: string, participants: NewRecipient[]): Promise<{ id: string; email: string }[]> {
  const normalized = participants.map((p) => ({ ...p, email: p.email.toLowerCase() }));

  return await db.$transaction(async (tx) => {
    return await Promise.all(
      normalized.map(async (participant) => {
        const authOptions = createAuthOptions({
          accessAuth: participant.accessAuth ?? [],
          actionAuth: participant.actionAuth ?? [],
        });

        const created = await (tx as any).recipient.create({
          data: {
            envelopeId,
            name: participant.name,
            email: participant.email,
            role: participant.role,
            signingOrder: participant.signingOrder,
            authOptions,
          },
        });

        return { id: created.id, email: created.email };
      }),
    );
  });
}



declare const teamDb: { $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> };
declare function generateInviteToken(): string;

export async function bootstrapTeamResources(teamId: string, memberIds: string[]): Promise<void> {
  await teamDb.$transaction(async (tx) => {
    await Promise.all(
      memberIds.map(async (memberId) => {
        await (tx as any).teamMembership.create({
          data: {
            teamId,
            userId: memberId,
            inviteToken: generateInviteToken(),
            role: 'MEMBER',
          },
        });
      }),
    );
  });
}



declare const envelopeDb: { $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> };
declare function buildFieldData(opts: { fieldType: string; envelopeId: string; recipientId: string }): unknown;

export async function provisionEnvelopeFields(envelopeId: string, fieldSpecs: { fieldType: string; recipientId: string }[]): Promise<void> {
  await envelopeDb.$transaction(async (tx) => {
    await Promise.all(
      fieldSpecs.map(async (spec) => {
        const data = buildFieldData({ fieldType: spec.fieldType, envelopeId, recipientId: spec.recipientId });
        await (tx as any).envelopeField.create({ data });
      }),
    );
  });
}



declare const recipientTxDb: { $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> };
declare function resolveRecipientPermissions(role: string): { canSign: boolean; canView: boolean };

export async function syncEnvelopeSigners(envelopeId: string, signers: { id: string; email: string; role: string }[]): Promise<void> {
  await recipientTxDb.$transaction(async (tx) => {
    await Promise.all(
      signers.map(async (signer) => {
        const permissions = resolveRecipientPermissions(signer.role);
        await (tx as any).envelopeSigner.upsert({
          where: { envelopeId_email: { envelopeId, email: signer.email } },
          update: { role: signer.role, ...permissions },
          create: { envelopeId, email: signer.email, role: signer.role, ...permissions },
        });
      }),
    );
  });
}



declare const fieldTxDb: { $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> };
declare function buildFieldPayload(fieldSpec: { type: string; pageNumber: number; x: number; y: number; width: number; height: number }): unknown;

export async function bulkCreateDocumentFields(documentId: string, fieldSpecs: { type: string; pageNumber: number; x: number; y: number; width: number; height: number; recipientId: string }[]): Promise<void> {
  await fieldTxDb.$transaction(async (tx) => {
    await Promise.all(
      fieldSpecs.map(async (spec) => {
        const payload = buildFieldPayload(spec);
        await (tx as any).documentField.create({
          data: {
            documentId,
            recipientId: spec.recipientId,
            ...(payload as object),
          },
        });
      }),
    );
  });
}
