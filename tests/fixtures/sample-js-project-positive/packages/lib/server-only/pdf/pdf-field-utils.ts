
declare const fieldValues: Record<string, string | boolean | number>;

function normalizeFieldValues(fieldValues: Record<string, string | boolean | number>) {
  return Object.entries(fieldValues).map(([key, value]) => [
    key,
    typeof value === 'boolean' ? value : value.toString(),
  ]);
}
