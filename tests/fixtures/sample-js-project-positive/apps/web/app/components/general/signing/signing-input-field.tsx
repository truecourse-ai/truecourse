
declare function useState<T>(init: T): [T, (v: T) => void];
declare function validateInputField(text: string, meta: any, strict: boolean): string[];

function handleInputChange(text: string, fieldMeta: any) {
  const errors = validateInputField(text, fieldMeta, true);
  return {
    required: errors.filter((err) => err.includes('required')),
    maxLength: errors.filter((err) => err.includes('character limit')),
  };
}

function onConfirmClick(localText: string, fieldMeta: any) {
  const errors = validateInputField(localText, fieldMeta, true);
  if (errors.length > 0) {
    return {
      required: errors.filter((err) => err.includes('required')),
      maxLength: errors.filter((err) => err.includes('character limit')),
    };
  }
  return null;
}
