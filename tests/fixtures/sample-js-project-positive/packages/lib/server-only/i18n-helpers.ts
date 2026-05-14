
// FF35 — i18n translation function called with MessageDescriptor; types match
type MessageDescriptor = { id: string; defaultMessage?: string };
declare function translate(descriptor: MessageDescriptor): string;
declare const validationMessages: {
  required: MessageDescriptor;
  tooShort: MessageDescriptor;
};

function getValidationLabel(key: keyof typeof validationMessages): string {
  return translate(validationMessages[key]);
}

const requiredLabel = getValidationLabel('required');
