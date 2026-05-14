function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}



// FP shape: index comes from findIndex on the same fields array and is used inside if(index !== -1).
// Bounded access guaranteed.
declare type TEditorField = { formId: string; id?: number; type: string; x: number; y: number };

function setFieldIdByFormId(
  fields: TEditorField[],
  formId: string,
  newId: number,
): TEditorField[] {
  const index = fields.findIndex((f) => f.formId === formId);
  if (index !== -1) {
    const updated = [...fields];
    updated[index] = { ...fields[index], id: newId };
    return updated;
  }
  return fields;
}



// FP shape: index comes from findIndex on localFields and is used inside if(index !== -1).
// Bounded access guaranteed.
declare type TLocalField = { formId: string; label: string; required: boolean; width: number; height: number };
declare function useCallback<T extends Function>(fn: T, deps: unknown[]): T;

function useFieldResize(
  localFields: TLocalField[],
  updateFields: (fields: TLocalField[]) => void,
) {
  const resizeField = useCallback(
    (formId: string, width: number, height: number) => {
      const index = localFields.findIndex((f) => f.formId === formId);
      if (index !== -1) {
        const updated = [...localFields];
        updated[index] = { ...localFields[index], width, height };
        updateFields(updated);
      }
    },
    [localFields, updateFields],
  );
  return { resizeField };
}



// FP shape: fieldIndex comes from findIndex and is used only inside if(fieldIndex !== -1);
// access is within bounds by construction.
declare type TConfigField = { id: string; label: string; x: number; y: number; width: number; height: number };
declare function useCallback<T extends Function>(fn: T, deps: unknown[]): T;

function useFieldUpdater(
  fields: TConfigField[],
  onUpdate: (fields: TConfigField[]) => void,
) {
  const moveField = useCallback(
    (fieldId: string, x: number, y: number) => {
      const fieldIndex = fields.findIndex((f) => f.id === fieldId);
      if (fieldIndex !== -1) {
        const updated = fields.slice();
        updated[fieldIndex] = { ...fields[fieldIndex], x, y };
        onUpdate(updated);
      }
    },
    [fields, onUpdate],
  );

  const resizeField = useCallback(
    (fieldId: string, width: number, height: number) => {
      const fieldIndex = fields.findIndex((f) => f.id === fieldId);
      if (fieldIndex !== -1) {
        const updated = fields.slice();
        updated[fieldIndex] = { ...fields[fieldIndex], width, height };
        onUpdate(updated);
      }
    },
    [fields, onUpdate],
  );

  return { moveField, resizeField };
}
