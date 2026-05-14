
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
