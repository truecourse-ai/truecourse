
// [unknown-catch-variable] catch(err) — console.error(err) + state setter + fixed toast
declare function autosaveEnvelopeDraft(opts: { envelopeId: string; fields: unknown[] }): Promise<void>;
declare function setAutosaveStatus(status: 'idle' | 'saving' | 'error'): void;
declare const editorToast: (opts: { title: string; description: string; variant?: string }) => void;
declare const envelopeId: string;
declare const currentFields: unknown[];

async function runAutosave(): Promise<void> {
  setAutosaveStatus('saving');
  try {
    await autosaveEnvelopeDraft({ envelopeId, fields: currentFields });
    setAutosaveStatus('idle');
  } catch (err) {
    console.error(err);
    setAutosaveStatus('error');
    editorToast({
      title: 'Autosave failed',
      description: 'We could not save your changes. Please try manually.',
      variant: 'destructive',
    });
  }
}
