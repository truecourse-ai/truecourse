// typeof checks with 'number' string — typeof keyword strings are not extractable constants
interface FieldRangeValues {
  minValue?: number | string;
  maxValue?: number | string;
}

function parseRangeValues(values: FieldRangeValues) {
  const min = typeof values.minValue === 'number' ? values.minValue : parseFloat(String(values.minValue ?? 0));
  const max = typeof values.maxValue === 'number' ? values.maxValue : parseFloat(String(values.maxValue ?? 100));
  return { min, max };
}
