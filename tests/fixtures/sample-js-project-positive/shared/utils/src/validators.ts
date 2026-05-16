export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
  return emailRegex.test(email);
}

export function validateName(name: string): boolean {
  return name.length >= 2 && name.length <= 100;
}



// FP shape: filename.endsWith('.ext') — standard String.endsWith
declare const uploadedFile: { name: string; size: number; type: string };

function isPdfFile(): boolean {
  return uploadedFile.name.endsWith('.pdf');
}

function isSupportedFormat(): boolean {
  return uploadedFile.name.endsWith('.pdf') || uploadedFile.name.endsWith('.docx');
}



// FP shape: z.string().refine((value) => !PATTERN.test(value), {...}) — standard Zod refine
declare const z: {
  string: () => {
    refine: (fn: (value: string) => boolean, opts: { message: string }) => unknown;
    min: (n: number) => any;
  };
};
const RESERVED_SLUG_PATTERN = /^(api|admin|app|www|help|support|mail|blog)$/i;

const SlugSchema = z.string().refine(
  (value) => !RESERVED_SLUG_PATTERN.test(value),
  { message: 'This slug is reserved and cannot be used' },
);



// FP shape: (arr ?? []).filter with try/catch validation — standard filter with side-effect guard
declare const rawTags: string[] | null;

function getValidTags(): string[] {
  return (rawTags ?? []).filter((tag) => {
    try {
      return /^[a-z0-9-]+$/.test(tag) && tag.length > 0;
    } catch {
      return false;
    }
  });
}



// Schema builder fluent API
declare const schemaBuilder: {
  string(): { nullable(): { optional(): any } };
  number(): { min(val: number): { max(val: number): any } };
  boolean(): { default(val: boolean): any };
  object(shape: Record<string, any>): any;
};

export const accountSchema = schemaBuilder.object({
  email: schemaBuilder.string().nullable(),
  displayName: schemaBuilder.string().optional(),
  age: schemaBuilder.number().min(18).max(120),
  isActive: schemaBuilder.boolean().default(true),
});

export const profileSchema = schemaBuilder.object({
  bio: schemaBuilder.string().nullable(),
  avatarUrl: schemaBuilder.string().nullable(),
});



// Shape: string.includes() with a constant string — no type mismatch
const CONTENT_TYPE_JSON = 'application/json';
const CONTENT_TYPE_MULTIPART = 'multipart/form-data';

export function parseRequestBody(contentType: string): 'json' | 'form' | 'unknown' {
  if (contentType.includes(CONTENT_TYPE_JSON)) {
    return 'json';
  }

  if (contentType.includes(CONTENT_TYPE_MULTIPART)) {
    return 'form';
  }

  return 'unknown';
}



// Shape: z.preprocess((val) => String(val) === 'true' || ..., z.boolean()) — valid Zod preprocessing, no type mismatch
declare const z: {
  preprocess: <T>(fn: (val: unknown) => unknown, schema: T) => T;
  boolean: () => { optional: () => unknown; default: (v: boolean) => unknown };
  object: (shape: Record<string, unknown>) => unknown;
};

export const QueryParamsSchema = z.object({
  verbose: z
    .preprocess((val) => String(val) === 'true' || String(val) === '1', z.boolean())
    .optional()
    .default(false),
  includeArchived: z
    .preprocess((val) => String(val) === 'true' || val === true, z.boolean())
    .optional()
    .default(false),
});



// FP shape: typeof type-guard for 'number' in a standalone validation function (type-system-discriminant)
interface NumberFieldMeta {
  minValue?: number;
  maxValue?: number;
  decimalPlaces?: number;
}

function validateNumericField(value: string, meta: NumberFieldMeta): string[] {
  const errors: string[] = [];
  const parsed = parseFloat(value);

  if (typeof meta.minValue === 'number' && meta.minValue > 0 && parsed < meta.minValue) {
    errors.push(`Value is less than minimum of ${meta.minValue}`);
  }

  if (typeof meta.maxValue === 'number' && meta.maxValue > 0 && parsed > meta.maxValue) {
    errors.push(`Value exceeds maximum of ${meta.maxValue}`);
  }

  return errors;
}



// FP shape: localized error substring used in a single component's filter call (single-usage-false-trigger)
declare function validateNumberInput(value: string, meta: unknown, isSigning: boolean): string[];

interface NumberFieldErrors {
  isNumber: string[];
  required: string[];
  minValue: string[];
  maxValue: string[];
}

function categorizeNumberErrors(rawValue: string, meta: unknown): NumberFieldErrors {
  const validationErrors = validateNumberInput(rawValue, meta, true);

  return {
    isNumber: validationErrors.filter((err) => err.includes('valid number')),
    required: validationErrors.filter((err) => err.includes('required')),
    minValue: validationErrors.filter((err) => err.includes('minimum value')),
    maxValue: validationErrors.filter((err) => err.includes('maximum value')),
  };
}



// Zod-style schema builder stub — no external import needed.
declare const z: {
  string(): ZodString;
};
interface ZodString {
  trim(): ZodString;
  toLowerCase(): ZodString;
  min(n: number, opts?: { message: string }): ZodString;
  max(n: number, opts?: { message: string }): ZodString;
  regex(pattern: RegExp, message?: string): ZodString;
  refine(fn: (v: string) => boolean, opts?: { message: string }): ZodString;
}

// Workspace and channel name schemas — numeric literals inside .min()/.max()
// calls are named length constraints on the Zod chain, not magic numbers.
export const ZWorkspaceNameSchema = z
  .string()
  .trim()
  .min(2, { message: 'Workspace name must be at least 2 characters long.' })
  .max(50, { message: 'Workspace name must not exceed 50 characters.' });

export const ZChannelSlugSchema = z
  .string()
  .trim()
  .min(3, { message: 'Channel slug must be at least 3 characters.' })
  .max(30, { message: 'Channel slug must not exceed 30 characters.' });



// Zod-style schema stubs — no import needed
declare interface ZodString {
  min(n: number): ZodString;
  max(n: number): ZodString;
  trim(): ZodString;
  toLowerCase(): ZodString;
  optional(): ZodString;
  email(): ZodString;
}
declare interface ZodNumber {
  min(n: number): ZodNumber;
  max(n: number): ZodNumber;
  optional(): ZodNumber;
}
declare const z: {
  object(shape: Record<string, unknown>): { parse(v: unknown): unknown };
  string(): ZodString;
  number(): ZodNumber;
};

// Schema-validation constraints using standard DB VARCHAR lengths.
// 255 and 254 are conventional VARCHAR limits — not magic numbers.
export const UpdateContactSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).optional(),
  displayName: z.string().max(255).optional(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  phoneNumber: z.string().max(20).optional(),
});

export const CreateTeamMemberSchema = z.object({
  email: z.string().email().max(254),
  fullName: z.string().min(1).max(255),
  role: z.string().max(50).optional(),
});



// Zod schema validation constraints — numeric literals in .min()/.max()/.length()
// are named minimums/maximums for form field validation, not magic numbers.
declare const z: {
  object: (shape: Record<string, unknown>) => ZodObject;
  string: () => ZodString;
  number: () => ZodNumber;
};
declare interface ZodObject { parse: (data: unknown) => unknown; }
declare interface ZodString {
  min: (n: number, msg?: string) => ZodString;
  max: (n: number, msg?: string) => ZodString;
  length: (n: number, msg?: string) => ZodString;
  nullish: () => ZodString;
  email: (msg?: string) => ZodString;
}
declare interface ZodNumber {
  min: (n: number, msg?: string) => ZodNumber;
  max: (n: number, msg?: string) => ZodNumber;
  nullable: () => ZodNumber;
}

const ZContactFormSchema = z.object({
  senderName: z.string().min(2, 'Name must be at least 2 characters'),
  subject: z.string().min(5, 'Subject is required'),
  body: z.string().min(20, 'Message must be at least 20 characters'),
  recipientId: z.number().min(1).nullable(),
  replyTo: z.string().email('Invalid reply-to address').nullish(),
});

export { ZContactFormSchema };



declare const z: any;

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(3, { message: 'Workspace name must be at least 3 characters long.' })
  .max(50, { message: 'Workspace name must not exceed 50 characters.' });

export const projectSlugSchema = z
  .string()
  .trim()
  .min(3, { message: 'Project slug must be at least 3 characters.' })
  .max(40, { message: 'Project slug must not exceed 40 characters.' })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Project slug may only contain lowercase letters, numbers, and hyphens.');



declare const phoneFormatRegexes: { value: string; regex: RegExp }[];

type PhoneFieldMeta = {
  minLength?: number;
  maxLength?: number;
  readOnly?: boolean;
  required?: boolean;
  phoneFormat?: string;
  fontSize?: number;
};

export const validatePhoneField = (
  value: string,
  fieldMeta?: PhoneFieldMeta,
  isSigningPage: boolean = false,
): string[] => {
  const errors = [];

  const { minLength, maxLength, readOnly, required, phoneFormat, fontSize } = fieldMeta || {};

  if (phoneFormat && value.length > 0) {
    const foundRegex = phoneFormatRegexes.find((item) => item.value === phoneFormat)?.regex;

    if (!foundRegex) {
      errors.push(`Invalid phone format - ${phoneFormat}`);
    }

    if (foundRegex && !foundRegex.test(value)) {
      errors.push(`Value ${value} does not match the phone format - ${phoneFormat}`);
    }
  }

  const trimmedValue = value.trim();

  if (isSigningPage && required && !value) {
    errors.push('Value is required');
  }

  if ((isSigningPage || value.length > 0) && !/^[+0-9()\-\s]+$/.test(trimmedValue)) {
    errors.push(`Value is not a valid phone number`);
  }

  if (typeof minLength === 'number' && minLength > 0 && trimmedValue.length < minLength) {
    errors.push(`Value ${value} is shorter than the minimum length of ${minLength}`);
  }

  if (typeof maxLength === 'number' && maxLength > 0 && trimmedValue.length > maxLength) {
    errors.push(`Value ${value} is longer than the maximum length of ${maxLength}`);
  }

  if (typeof minLength === 'number' && typeof maxLength === 'number' && minLength > maxLength) {
    errors.push('Minimum length cannot be greater than maximum length');
  }

  if (typeof maxLength === 'number' && typeof minLength === 'number' && maxLength < minLength) {
    errors.push('Maximum length cannot be less than minimum length');
  }

  if (readOnly && trimmedValue.length < 1) {
    errors.push('A read-only field must have a non-empty value');
  }

  if (readOnly && required) {
    errors.push('A field cannot be both read-only and required');
  }

  if (fontSize && (fontSize < 8 || fontSize > 96)) {
    errors.push('Font size must be between 8 and 96.');
  }

  return errors;
};
