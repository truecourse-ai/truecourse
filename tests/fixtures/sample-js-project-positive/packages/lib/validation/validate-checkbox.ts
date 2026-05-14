
// FP: function with typed positional params — not a complex expression
interface CheckboxFieldMeta { minChecked?: number; maxChecked?: number; required?: boolean }

function validateCheckboxValues(values: string[], fieldMeta: CheckboxFieldMeta): boolean {
  const count = values.length;
  if (fieldMeta.minChecked !== undefined && count < fieldMeta.minChecked) return false;
  if (fieldMeta.maxChecked !== undefined && count > fieldMeta.maxChecked) return false;
  return true;
}
