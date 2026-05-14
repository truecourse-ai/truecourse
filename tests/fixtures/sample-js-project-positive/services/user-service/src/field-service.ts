
// --- shape df6ebef35ba3: prisma.$transaction(async tx => ...) ---
declare const prisma: {
  $transaction: <T>(fn: (tx: { field: { deleteMany: (opts: unknown) => Promise<void> }; auditLog: { createMany: (opts: unknown) => Promise<void> } }) => Promise<T>) => Promise<T>;
};
declare const removedFields: Array<{ id: string; type: string; recipientId: number | null }>;
declare const envelopeId: string;

await prisma.$transaction(async (tx) => {
  await tx.field.deleteMany({
    where: {
      id: { in: removedFields.map((field) => field.id) },
    },
  });

  await tx.auditLog.createMany({
    data: removedFields.map((field) => ({
      type: 'FIELD_DELETED',
      envelopeId,
      fieldId: field.id,
      fieldType: field.type,
    })),
  });
});


// --- argument-type-mismatch FP: Array.filter with nested Array.find predicate ---
// existingAnnotations.filter(a => !annotations.find(b => b.id === a.id)) — valid diff pattern.
interface AnnotationItem { id: string; type: string; label?: string; value: string }

declare const existingAnnotations: AnnotationItem[];
declare const updatedAnnotations: AnnotationItem[];
declare function removeAnnotation(id: string): Promise<void>;

export async function reconcileAnnotations(): Promise<void> {
  const removedAnnotations = existingAnnotations.filter(
    (existing) => !updatedAnnotations.find((annotation) => annotation.id === existing.id),
  );

  for (const annotation of removedAnnotations) {
    await removeAnnotation(annotation.id);
  }
}



// --- argument-type-mismatch FP: Array.find comparing sign.label to validationRule string ---
// checkboxRules.find(rule => rule.label === selectedRule) — standard lookup; no type mismatch.
type CheckboxValidationRule = { label: string; value: string; operator: '=' | '<=' | '>=' };
type CheckboxOption = { label: string; value: string; selected?: boolean };

declare const checkboxValidationRules: CheckboxValidationRule[];
declare class FieldValidationError extends Error { constructor(code: string, opts: { message: string }); }

export function resolveCheckedChoices(
  options: CheckboxOption[],
  selectedRule: string,
  clickedLabel: string,
): CheckboxOption | null {
  const matchedRule = checkboxValidationRules.find((rule) => rule.label === selectedRule);

  if (!matchedRule) {
    throw new FieldValidationError('INVALID_REQUEST', { message: 'Invalid checkbox validation rule' });
  }

  const clickedOption = options.find((opt) => opt.label === clickedLabel);
  return clickedOption ?? null;
}



// FP shape: Array.includes() checking field.type against a constant array —
// standard includes check; no type mismatch.
declare const AUTO_COMPLETE_FIELD_TYPES: readonly string[];

interface EnvelopeField {
  id: string;
  type: string;
  recipientId: number;
  readOnly?: boolean;
}

export function canAutoCompleteField(field: EnvelopeField): boolean {
  if (!AUTO_COMPLETE_FIELD_TYPES.includes(field.type)) {
    throw new Error(`Field type "${field.type}" does not support auto-complete`);
  }
  return true;
}



// argument-type-mismatch: typed call site with a genuine TypeScript argument type error
function validateFieldLabel(label: string, maxLength: number): boolean { return label.length <= maxLength; }
// TS2345: Argument of type 'number' is not assignable to parameter of type 'string'
const _labelValid = validateFieldLabel(100, 50);

