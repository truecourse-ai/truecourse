declare function renderFieldSignature(fieldId: string): Promise<Buffer>;
declare function renderFieldInitials(fieldId: string): Promise<Buffer>;

export async function insertFieldsInPdf(fields: Array<{ id: string; type: 'signature' | 'initials' }>) {
  const renderedBuffers = await Promise.all(
    fields.map((f) =>
      f.type === 'signature' ? renderFieldSignature(f.id) : renderFieldInitials(f.id),
    ),
  );
  return renderedBuffers;
}
