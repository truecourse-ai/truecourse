// Admin HTTP handler — owns the response shape for administrative routes.
// Lives in the api layer alongside the other handlers; should not be reached
// from the data layer, which is the false positive captured below.

declare const adminAuditStore: { recordRequest(payload: { actor: string; action: string }): Promise<void> };

export async function processAdminRequest(actor: string, action: string): Promise<{ ok: true }> {
  await adminAuditStore.recordRequest({ actor, action });
  return { ok: true };
}
