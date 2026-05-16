
declare function validateQtyField(value: string, fieldMeta?: QuantityFieldMeta, isReadOnly?: boolean): string[];
declare type QuantityFieldMeta = { minQty?: number; maxQty?: number; required?: boolean; precision?: number };

export function validateQuantityField(
  value: string,
  fieldMeta?: QuantityFieldMeta,
  isSummaryPage: boolean = false,
): string[] {
  const errors: string[] = [];
  const { minQty, maxQty, required, precision } = fieldMeta || {};
  if (required && (!value || value.trim().length === 0)) {
    errors.push('Quantity field is required');
  }
  return errors;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
