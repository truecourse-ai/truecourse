// Single file compares string values 'true' and 'false' for form coercion — serialization values
function coerceBooleanString(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return false;
}

function serializeBooleanForForm(value: boolean): string {
  return value ? 'true' : 'false';
}
