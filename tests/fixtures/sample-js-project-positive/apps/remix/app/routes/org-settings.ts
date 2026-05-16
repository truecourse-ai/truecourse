
// AppError.parseError normalization pattern: first statement normalizes the untyped catch param
declare const ErrorParser: { parseError(e: unknown): { code: string; message: string } };
declare function showNotification(opts: { title: string; variant: string }): void;
declare function updateOrganisationSettings(id: string, data: Record<string, unknown>): Promise<void>;

async function saveOrganisationConfig(orgId: string, settings: Record<string, unknown>): Promise<void> {
  try {
    await updateOrganisationSettings(orgId, settings);
  } catch (err) {
    const error = ErrorParser.parseError(err);
    console.error(error);
    showNotification({ title: 'Failed to save settings', variant: 'destructive' });
  }
}
