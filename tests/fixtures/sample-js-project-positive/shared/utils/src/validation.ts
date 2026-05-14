
// Sequential flat validation — independent if-blocks accumulating errors; cognitive complexity
// score comes purely from branch count, not from structural nesting.
type CheckboxMeta = {
  readOnly?: boolean;
  required?: boolean;
  validationRule?: string;
  validationLength?: number;
};

export function validateCheckboxOptions(values: string[], meta: CheckboxMeta, isSigningPage = false): string[] {
  const errors: string[] = [];

  if (meta.readOnly && meta.required) {
    errors.push('A field cannot be both read-only and required');
  }

  if (values.length === 0) {
    errors.push('At least one option must be added');
  }

  if (meta.readOnly && values.length === 0) {
    errors.push('A read-only field must have a value');
  }

  if (isSigningPage && meta.required && values.length === 0) {
    errors.push('Selecting an option is required');
  }

  if (meta.validationRule && !meta.validationLength) {
    errors.push('Specify the number of options for validation');
  }

  if (meta.validationLength && !meta.validationRule) {
    errors.push('Specify the validation rule');
  }

  if (meta.validationRule && meta.validationLength) {
    const allowed = ['=', '>=', '<='];
    if (!allowed.includes(meta.validationRule)) {
      errors.push('Unknown validation rule');
    }
  }

  return errors;
}



// Cascade of independent flat if-return guards — effectively a lookup table.
// Cognitive complexity accumulates from branch count, not structural nesting.
export function isInternalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.+$/, '');

  if (h === 'localhost') return true;
  if (h === '::1' || h === '::') return true;
  if (h === '0.0.0.0') return true;
  if (h.startsWith('127.')) return true;
  if (h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  if (h.startsWith('169.254.')) return true;
  if (h.startsWith('fe80:')) return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true;

  if (h.startsWith('172.')) {
    const second = parseInt(h.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }

  return false;
}



// Flat sequential validator — zero nesting, cognitive complexity penalty
// comes purely from branch count over independent if-statements.
type DropdownMeta = {
  readOnly?: boolean;
  required?: boolean;
  values?: Array<{ value: string }>;
  defaultValue?: string;
};

export function validateDropdownOptions(
  value: string | undefined,
  meta: DropdownMeta,
  isSigningPage = false,
): string[] {
  const errors: string[] = [];
  const { readOnly, required, values, defaultValue } = meta;

  if (readOnly && required) errors.push('A field cannot be both read-only and required');
  if (readOnly && (!values || values.length === 0)) errors.push('A read-only field must have at least one value');
  if (isSigningPage && required && !value) errors.push('Choosing an option is required');
  if (values && values.length === 0) errors.push('Select field must have at least one option');
  if (values && defaultValue && !values.find((i) => i.value === defaultValue)) {
    errors.push('Default value must be one of the available options');
  }
  if (value && values && !values.find((i) => i.value === value)) {
    errors.push('Selected value must be one of the available options');
  }
  if (values && values.some((i) => i.value.length < 1)) errors.push('Option value cannot be empty');
  if (values && new Set(values.map((i) => i.value)).size !== values.length) {
    errors.push('Duplicate values are not allowed');
  }

  return errors;
}



// Flat sequential number validator — maximum nesting depth two; cognitive
// complexity penalty comes from branch count only.
type NumberMeta = {
  minValue?: number;
  maxValue?: number;
  readOnly?: boolean;
  required?: boolean;
  fontSize?: number;
};

export function validateNumberInput(value: string, meta: NumberMeta = {}, isSigningPage = false): string[] {
  const errors: string[] = [];
  const { minValue, maxValue, readOnly, required, fontSize } = meta;
  const num = parseFloat(value);

  if (isSigningPage && required && !value) errors.push('Value is required');

  if ((isSigningPage || value.length > 0) && !/^[0-9,.]+$/.test(value.trim())) {
    errors.push('Value is not a valid number');
  }

  if (typeof minValue === 'number' && minValue > 0 && num < minValue) {
    errors.push(`Value is less than the minimum of ${minValue}`);
  }

  if (typeof maxValue === 'number' && maxValue > 0 && num > maxValue) {
    errors.push(`Value exceeds the maximum of ${maxValue}`);
  }

  if (typeof minValue === 'number' && typeof maxValue === 'number' && minValue > maxValue) {
    errors.push('Minimum value cannot be greater than maximum value');
  }

  if (readOnly && num < 1) errors.push('A read-only field must have a value greater than 0');
  if (readOnly && required) errors.push('A field cannot be both read-only and required');
  if (fontSize && (fontSize < 8 || fontSize > 96)) errors.push('Font size must be between 8 and 96');

  return errors;
}



import { z } from 'zod';

const domainPattern = /^(?!https?:\/\/)(?!www\.)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export const ZDomainSchema = z.string().regex(domainPattern, { message: 'Invalid domain name' }).toLowerCase();

export const ZCreateOrgEmailDomainSchema = z.object({
  orgId: z.string(),
  domain: ZDomainSchema,
});



const SPECIAL_CHAR_REGEX = /[`~<>?,./!@#$%^&*()\-_"'+=|{}[\];:\\]/;

export function hasSpecialCharacter(value: string): boolean {
  return SPECIAL_CHAR_REGEX.test(value);
}



// Positive: argument-type-mismatch — Number.isNaN() || comparison; standard number validation.
export function parseWorkspaceId(rawId: string | null): number {
  if (rawId === null) {
    throw new Error('Workspace ID is required');
  }
  const parsed = Number(rawId);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid workspace ID: ${rawId}`);
  }
  return parsed;
}




// Positive: argument-type-mismatch — Zod .refine() with boolean predicate.
// .refine(value => value.length > 25 || /regex/.test(value), {...}) is a valid Zod refinement.
declare const z: {
  string(): {
    min(n: number, opts: { message: string }): any;
    max(n: number, opts: { message: string }): any;
  };
};

function addPasswordStrengthRefinements(base: any): any {
  return base
    .refine(
      (value: string) => value.length > 25 || /[A-Z]/.test(value),
      { message: 'Must contain at least one uppercase letter' },
    )
    .refine(
      (value: string) => value.length > 25 || /[a-z]/.test(value),
      { message: 'Must contain at least one lowercase letter' },
    )
    .refine(
      (value: string) => value.length > 25 || /\d/.test(value),
      { message: 'Must contain at least one number' },
    );
}

export const ZStrongPassword = addPasswordStrengthRefinements(
  z.string()
    .min(8, { message: 'Minimum 8 characters required' })
    .max(72, { message: 'Maximum 72 characters allowed' }),
);

