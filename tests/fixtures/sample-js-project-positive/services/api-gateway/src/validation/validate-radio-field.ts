
declare const radioValidationRules: Array<{ label: string; value: string }>;

type RadioFieldMeta = {
  readOnly?: boolean;
  required?: boolean;
  validationRule?: string;
  options?: string[];
};

export const validateRadioField = (
  selectedValue: string | null,
  fieldMeta: RadioFieldMeta,
  isSigningPage = false,
): string[] => {
  const errors: string[] = [];

  const { readOnly, required, validationRule, options } = fieldMeta;

  if (readOnly && required) {
    errors.push('A field cannot be both read-only and required');
  }

  if (!options || options.length === 0) {
    errors.push('At least one option must be configured');
  }

  if (readOnly && !selectedValue) {
    errors.push('A read-only radio field must have a default value');
  }

  if (isSigningPage && required && !selectedValue) {
    errors.push('Selecting an option is required');
  }

  if (validationRule) {
    const rule = radioValidationRules.find((r) => r.label === validationRule);

    if (rule) {
      let conditionFailed = false;

      switch (rule.value) {
        case 'must-select':
          conditionFailed = isSigningPage ? !selectedValue : false;
          break;
        case 'must-not-select':
          conditionFailed = isSigningPage ? !!selectedValue : false;
          break;
      }

      if (conditionFailed) {
        let errorMessage: string;

        if (isSigningPage) {
          errorMessage = `Validation failed: ${validationRule}`;
        } else {
          errorMessage = `Default value must satisfy rule: ${validationRule}`;
        }

        errors.push(errorMessage);
      }
    }
  }

  return errors;
};
