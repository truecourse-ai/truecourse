
declare function updateEnvelope(envelopeId: string, data: Record<string, unknown>): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleEnvelopeUpdate(envelopeId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await updateEnvelope(envelopeId, data);
    showToast({ title: 'Envelope updated', description: 'Changes saved successfully.' });
  } catch (err) {
    console.error('Failed to update envelope:', err);
    showToast({
      title: 'Error',
      description: 'Failed to update envelope. Please try again.',
      variant: 'destructive',
    });
  }
}
