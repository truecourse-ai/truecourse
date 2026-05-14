
// AppError.parseError normalization: immediately normalizes err then checks error.code
declare const TypedErrorParser: { parseError(e: unknown): { code: string; message: string } };
declare function showNotification(opts: { title: string; variant: string }): void;
declare function submitCheckboxFieldValue(fieldId: string, value: boolean): Promise<void>;

async function handleCheckboxFieldSubmit(fieldId: string, checked: boolean): Promise<void> {
  try {
    await submitCheckboxFieldValue(fieldId, checked);
  } catch (err) {
    const error = TypedErrorParser.parseError(err);
    if (error.code === 'FIELD_LOCKED') {
      showNotification({ title: 'This field is locked', variant: 'destructive' });
    } else {
      showNotification({ title: 'Failed to submit', variant: 'destructive' });
    }
  }
}
