
// Enum dispatch in tRPC handler — comparing field type to route signing logic
declare const enum FieldKind { SIGNATURE = 'SIGNATURE', TEXT = 'TEXT', DATE = 'DATE' }
declare const enum RecipientKind { ASSISTANT = 'ASSISTANT', SIGNER = 'SIGNER' }
declare const AppError: new (code: string, opts: any) => Error;
declare const AppErrorCode: { INVALID_REQUEST: string };

interface FormField { id: string; type: FieldKind; recipientId: string; }
interface Actor { id: string; role: RecipientKind; }

export function validateFieldAccess(field: FormField, actor: Actor) {
  if (
    field.type === FieldKind.SIGNATURE &&
    actor.id !== field.recipientId &&
    actor.role === RecipientKind.ASSISTANT
  ) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Assistant recipients cannot sign signature fields',
    });
  }
}



// Enum type guard to reject wrong field type before processing — enum check, not secret
declare const enum AnnotationType { HIGHLIGHT = 'HIGHLIGHT', NOTE = 'NOTE', DRAWING = 'DRAWING' }
declare const AppError: new (code: string, opts: any) => Error;
declare const AppErrorCode: { INVALID_REQUEST: string };

interface Annotation { id: string; type: AnnotationType; }

export function processDrawingAnnotation(annotation: Annotation) {
  if (annotation.type !== AnnotationType.DRAWING) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, { message: 'Invalid annotation type' });
  }
  // proceed with drawing-specific processing
}



// Boolean feature flag comparison to reject input when feature is disabled — not a secret
declare const AppError: new (code: string, opts: any) => Error;
declare const AppErrorCode: { INVALID_REQUEST: string };

interface OrgSettings { typedSignatureEnabled: boolean; drawSignatureEnabled: boolean; }

export function rejectTypedSignatureIfDisabled(value: string, settings: OrgSettings) {
  const isTyped = !value.startsWith('data:image');

  if (isTyped && settings.typedSignatureEnabled === false) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Typed signatures are not allowed',
    });
  }
}



// Enum comparison to classify template fields — Prisma enum for categorization, not secret
declare const enum TemplateFieldType { SIGNATURE = 'SIGNATURE', FREE_SIGNATURE = 'FREE_SIGNATURE', TEXT = 'TEXT', DATE = 'DATE' }

interface TemplateField { id: string; type: TemplateFieldType; }

export function isTemplateFieldSignature(templateField: TemplateField): boolean {
  return (
    templateField.type === TemplateFieldType.SIGNATURE ||
    templateField.type === TemplateFieldType.FREE_SIGNATURE
  );
}



// Filtering on signature === null to separate non-signature fields — null check for grouping, not secret
interface PreparedField { id: string; signature: { imageBase64?: string } | null; }

export function partitionFieldsBySignature(fields: PreparedField[]) {
  const nonSignatureFields = fields.filter(({ signature }) => signature === null);
  const signatureFields = fields.filter(({ signature }) => signature !== null);
  return { nonSignatureFields, signatureFields };
}



// Enum type validation — comparing field value type against expected field type, not a secret
declare const enum FieldType { SIGNATURE = 'SIGNATURE', TEXT = 'TEXT', DATE = 'DATE' }
declare const AppError: new (code: string, opts: any) => Error;
declare const AppErrorCode: { INVALID_REQUEST: string };

interface FieldValue { type: FieldType; value?: string; }
interface Field { id: string; type: FieldType; }

export function assertFieldValueMatchesFieldType(field: Field, fieldValue: FieldValue) {
  if (fieldValue.type !== field.type) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Field value type '${fieldValue.type}' does not match field type '${field.type}'`,
    });
  }
}



// Enum comparison to classify a field as signature type — Prisma enum, not secret
declare const enum FieldType { SIGNATURE = 'SIGNATURE', FREE_SIGNATURE = 'FREE_SIGNATURE', TEXT = 'TEXT' }

interface DocumentField { id: string; type: FieldType; value?: string; isBase64?: boolean; }

export function classifyFieldAsSignature(field: DocumentField) {
  const isSignatureField = field.type === FieldType.SIGNATURE || field.type === FieldType.FREE_SIGNATURE;
  const signatureImageAsBase64 = isSignatureField && field.isBase64 ? field.value : undefined;
  const typedSignature = isSignatureField && !field.isBase64 ? field.value : undefined;

  return { isSignatureField, signatureImageAsBase64, typedSignature };
}
