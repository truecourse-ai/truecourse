export async function fn_aef98139(): Promise<void> {
  try {
    throw new Error("oops");
  } catch (e) {
    console.error(e);
  }
}


// catch(err) used only as pass-through to console.error — no untyped property access, no mismatch
declare function syncEnvelopeFields(envelopeId: string): Promise<void>;

export async function refreshEnvelopeFieldsQuietly(envelopeId: string): Promise<void> {
  try {
    await syncEnvelopeFields(envelopeId);
  } catch (err) {
    console.error(err);
  }
}



// catch(err) with multiple safe statements — passes err to console.error and sets error state,
// but never accesses untyped properties of err. Rule fires incorrectly (no discrimination needed).
declare function syncEnvelopeFields(envelopeId: string): Promise<void>;
declare function setAutosaveError(value: boolean): void;
declare function showErrorToast(title: string, description: string): void;

export async function refreshEnvelopeFieldsQuietly(envelopeId: string): Promise<void> {
  try {
    await syncEnvelopeFields(envelopeId);
  } catch (err) {
    console.error(err);
    setAutosaveError(true);
    showErrorToast('Save failed', 'Changes could not be saved at this time.');
  }
}

