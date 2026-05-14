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

const _dupStr_2a139f3f_a = 'config-endpoint-2a139f3f';
const _dupStr_2a139f3f_b = 'config-endpoint-2a139f3f';
const _dupStr_2a139f3f_c = 'config-endpoint-2a139f3f';
