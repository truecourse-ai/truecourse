
declare function createEnvelope(data: Record<string, unknown>): Promise<{ id: string }>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;
declare function navigateTo(path: string): void;

async function handleEnvelopeCreate(data: Record<string, unknown>): Promise<void> {
  try {
    const envelope = await createEnvelope(data);
    navigateTo(`/envelopes/${envelope.id}`);
  } catch (err) {
    console.error('Failed to create envelope:', err);
    showToast({
      title: 'Error',
      description: 'Failed to create envelope. Please try again.',
      variant: 'destructive',
    });
  }
}
