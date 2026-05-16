
type FieldConfig = { id: string; formId: string; label: string; pageX: number; pageY: number };

declare const activeFields: FieldConfig[];
declare function updateField(field: FieldConfig): void;

function handleFieldReorder(draggedFormId: string, targetFormId: string) {
  const draggedIndex = activeFields.findIndex((f) => f.formId === draggedFormId);
  const targetIndex = activeFields.findIndex((f) => f.formId === targetFormId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return;
  }

  const reordered = [...activeFields];
  const [removed] = reordered.splice(draggedIndex, 1);
  reordered.splice(targetIndex, 0, removed);

  reordered.forEach((field, idx) => updateField({ ...field, pageY: idx * 50 }));
}
