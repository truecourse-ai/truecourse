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


// nested filter+find — pendingFields filtered by absence in existing envelope items, no type mismatch
interface EnvelopeFieldItem {
  id: string;
  label: string;
  pageNumber: number;
}

interface EnvelopeSection {
  sectionId: string;
  fields: EnvelopeFieldItem[];
}

declare const pendingFieldUploads: EnvelopeFieldItem[];
declare const existingSections: EnvelopeSection[];

function getUnplacedFields(): EnvelopeFieldItem[] {
  return pendingFieldUploads.filter(
    (field) =>
      !existingSections.find(
        (section) => section.fields.find((existing) => existing.id === field.id),
      ),
  );
}



// catch(err) passes err directly to console.error — no untyped property access on err.
declare function updateEnvelopeItemDetails(itemId: string, data: Record<string, unknown>): Promise<void>;

async function handleEnvelopeItemUpdate(itemId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await updateEnvelopeItemDetails(itemId, data);
  } catch (err) {
    console.error(err);
  }
}



// tRPC useMutation onSuccess callback destructuring data — standard tRPC pattern, no argument type mismatch
declare function useTrpcMutation<T>(opts: { onSuccess: (result: T) => void; onError: () => void }): { mutateAsync: (input: unknown) => Promise<T> };
declare function useEnvelopeStore(): { updateEnvelopeItems: (items: unknown[]) => void };

type EnvelopeEditResult = { data: { id: string; title: string }; meta: { updatedAt: Date } | null };

function useEnvelopeItemEditMutation() {
  const { updateEnvelopeItems } = useEnvelopeStore();

  const { mutateAsync: editEnvelopeItem } = useTrpcMutation<EnvelopeEditResult>({
    onSuccess: ({ data, meta }) => {
      updateEnvelopeItems([{ id: data.id, title: data.title, updatedAt: meta?.updatedAt }]);
    },
    onError: () => {
      console.error('Envelope item edit failed');
    },
  });

  return { editEnvelopeItem };
}



// Positive sample: catch-without-error-type fires on the existing catch block at line 120.
// That catch block has 2+ statements (console.error + toast) with no instanceof/typeof check.



// Positive sample: argument-type-mismatch fires on the existing tRPC useMutation
// onSuccess destructuring pattern in this file — the TS compiler reports the mismatch.

