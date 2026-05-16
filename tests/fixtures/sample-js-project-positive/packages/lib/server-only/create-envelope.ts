declare function insertEnvelopeFields(envelopeId: string, fields: string[]): Promise<void>;
declare function insertEnvelopeRecipients(envelopeId: string, recipients: string[]): Promise<void>;

export async function createEnvelope(name: string, fields: string[], recipients: string[]): Promise<string> {
  const envelopeId = `env_${Date.now()}`;
  await Promise.all([
    insertEnvelopeFields(envelopeId, fields),
    insertEnvelopeRecipients(envelopeId, recipients),
  ]);
  return envelopeId;
}



declare function attachEnvelopeWebhooks(envelopeId: string, webhookIds: string[]): Promise<void>;
declare function attachEnvelopeTeamPermissions(envelopeId: string, teamId: string): Promise<void>;

export async function configureEnvelopeExtras(envelopeId: string, teamId: string, webhookIds: string[]) {
  await Promise.all([
    attachEnvelopeWebhooks(envelopeId, webhookIds),
    attachEnvelopeTeamPermissions(envelopeId, teamId),
  ]);
}



declare function createEnvelopeRecord(name: string, ownerId: string): Promise<{ id: string }>;
declare function attachEnvelopeFile(envelopeId: string, fileId: string): Promise<void>;
declare function setInitialEnvelopeStatus(envelopeId: string): Promise<void>;

export async function createEnvelopeWithFile(name: string, ownerId: string, fileId: string) {
  const envelope = await createEnvelopeRecord(name, ownerId);
  await Promise.all([
    attachEnvelopeFile(envelope.id, fileId),
    setInitialEnvelopeStatus(envelope.id),
  ]);
  return envelope;
}
