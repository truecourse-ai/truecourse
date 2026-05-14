
// FP: function with typed positional params — not a complex expression
interface CheckboxFieldMeta { minChecked?: number; maxChecked?: number; required?: boolean }

function validateCheckboxValues(values: string[], fieldMeta: CheckboxFieldMeta): boolean {
  const count = values.length;
  if (fieldMeta.minChecked !== undefined && count < fieldMeta.minChecked) return false;
  if (fieldMeta.maxChecked !== undefined && count > fieldMeta.maxChecked) return false;
  return true;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
