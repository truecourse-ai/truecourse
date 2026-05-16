
// Shape: function call with object argument containing correctly typed number properties
declare function createWorkspace(opts: { ownerId: number; teamId?: number; title: string; type: string }): Promise<{ id: string }>;
declare const currentUser: { id: number };
declare const teamId: number;

async function provisionWorkspace(title: string, type: string) {
  const workspace = await createWorkspace({
    ownerId: currentUser.id,
    teamId,
    title,
    type,
  });
  return workspace;
}



// Shape: function call with optional number field (userId?: number) so number|undefined is valid
declare function getDocumentForSigning(opts: { token: string; viewerId?: number }): Promise<{ id: string; title: string }>;
declare const viewer: { id?: number } | null;

async function loadDocumentForViewer(token: string, viewer: { id?: number } | null) {
  const document = await getDocumentForSigning({
    token,
    viewerId: viewer?.id,
  });
  return document;
}



// Shape: createRecord({userId, teamId, ...}) object argument — no type mismatch
declare function createDraftContract(opts: {
  userId: string;
  workspaceId: string;
  normalizePdf: boolean;
  title: string;
  externalRef: string | null;
}): Promise<{ id: string }>;
declare const currentUserId: string;
declare const currentWorkspaceId: string;
declare const contractTitle: string;

export async function initDraftContract() {
  const contract = await createDraftContract({
    userId: currentUserId,
    workspaceId: currentWorkspaceId,
    normalizePdf: false,
    title: contractTitle,
    externalRef: null,
  });

  return contract;
}



// --- inconsistent-return shape: void early-exit guard vs value return (result discarded) ---
// handleOwnerSoftDelete returns void on the guard path (already deleted) but
// returns the record object on the main path. The sole call site discards the
// return value unconditionally — the inconsistency cannot cause a runtime bug.
declare type Envelope = { id: string; deletedAt: Date | null; status: string };
declare function softDeleteEnvelope(envelopeId: string): Promise<Envelope>;
declare function isCompleted(status: string): boolean;
declare function notifyRecipients(envelopeId: string): Promise<void>;

const handleOwnerSoftDelete = async (envelope: Envelope): Promise<Envelope | void> => {
  if (envelope.deletedAt) {
    return;
  }

  if (isCompleted(envelope.status)) {
    const updated = await softDeleteEnvelope(envelope.id);
    await notifyRecipients(envelope.id);
    return updated;
  }

  return await softDeleteEnvelope(envelope.id);
};

export async function deleteUserDocument(envelopeId: string, envelope: Envelope): Promise<void> {
  await handleOwnerSoftDelete(envelope);
}
