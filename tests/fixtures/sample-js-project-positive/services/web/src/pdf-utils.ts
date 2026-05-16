
declare function signField(fieldId: string, payload: { value?: unknown }): Promise<{ inserted: boolean }>;
declare function onFieldSigned(opts: { fieldId: string; value?: string; isBase64?: boolean }): void;
declare function onFieldUnsigned(opts: { fieldId: string }): void;
declare function isBase64Image(s: string): boolean;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleFieldSign(fieldId: string, payload: { value?: unknown }): Promise<void> {
  try {
    const { inserted } = await signField(fieldId, payload);
    if (inserted) {
      const value = payload.value ? JSON.stringify(payload.value) : undefined;
      const isBase64 = value ? isBase64Image(value) : undefined;
      onFieldSigned({ fieldId, value, isBase64 });
    } else {
      onFieldUnsigned({ fieldId });
    }
  } catch (err) {
    console.error(err);
    showToast({ title: 'Error', description: 'An error occurred while signing the field.', variant: 'destructive' });
    throw err;
  }
}



declare function completeEnvelopeSigning(envelopeId: string): Promise<void>;
declare function notifyCompletion(): void;

async function handleSigningComplete(envelopeId: string): Promise<void> {
  try {
    await completeEnvelopeSigning(envelopeId);
    notifyCompletion();
  } catch (err) {
    console.log('err', err);
    throw err;
  }
}



declare function prepareSignaturePage(pageId: string): Promise<{ rendered: boolean }>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handlePageRender(pageId: string): Promise<void> {
  try {
    await prepareSignaturePage(pageId);
  } catch (err) {
    console.error('Failed to prepare signature page for rendering:', err);
    console.error(err);
    showToast({ title: 'Error', description: 'Failed to render page.', variant: 'destructive' });
  }
}
