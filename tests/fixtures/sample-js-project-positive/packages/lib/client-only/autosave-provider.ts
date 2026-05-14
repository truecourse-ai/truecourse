declare function persistFieldChanges(fieldId: string, value: string): Promise<void>;
declare function persistSignatureChanges(sigId: string, data: string): Promise<void>;

async function flushAutosave(
  pendingFields: Array<{ id: string; value: string }>,
  pendingSignatures: Array<{ id: string; data: string }>,
) {
  await Promise.all([
    ...pendingFields.map((f) => persistFieldChanges(f.id, f.value)),
    ...pendingSignatures.map((s) => persistSignatureChanges(s.id, s.data)),
  ]);
}

export async function handleSaveButtonClick(
  pendingFields: Array<{ id: string; value: string }>,
  pendingSignatures: Array<{ id: string; data: string }>,
) {
  try {
    await flushAutosave(pendingFields, pendingSignatures);
  } catch (err) {
    console.error('Autosave failed', err);
  }
}



declare function persistAnnotationChanges(annotationId: string, data: string): Promise<void>;
declare function persistCommentChanges(commentId: string, text: string): Promise<void>;

async function flushAnnotations(
  pendingAnnotations: Array<{ id: string; data: string }>,
  pendingComments: Array<{ id: string; text: string }>,
) {
  await Promise.all([
    ...pendingAnnotations.map((a) => persistAnnotationChanges(a.id, a.data)),
    ...pendingComments.map((c) => persistCommentChanges(c.id, c.text)),
  ]);
}

export async function handleAnnotationSave(
  pendingAnnotations: Array<{ id: string; data: string }>,
  pendingComments: Array<{ id: string; text: string }>,
) {
  try {
    await flushAnnotations(pendingAnnotations, pendingComments);
  } catch (err) {
    console.error('Annotation flush failed', err);
  }
}
