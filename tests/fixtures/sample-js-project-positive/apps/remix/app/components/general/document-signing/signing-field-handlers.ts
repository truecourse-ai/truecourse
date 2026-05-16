
// Pass-through: catch block passes err to console.error and shows fully static toast message
async function signCheckboxField2(fieldId: string, recipientToken: string): Promise<void> {
  try {
    await applyCheckboxFieldSignature(fieldId, recipientToken);
  } catch (err) {
    console.error(err);
    showToast({ title: 'Unable to sign field', description: 'Please refresh and try again.', variant: 'destructive' });
  }
}

declare function applyCheckboxFieldSignature(fieldId: string, token: string): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant: string }): void;
