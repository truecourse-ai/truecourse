import { helper_540f098f, type Foo_540f098f, type Bar_540f098f } from './module-540f098f';
export function use_540f098f(f: Foo_540f098f, b: Bar_540f098f): unknown { return helper_540f098f(f, b); }


// TS 4.5+ inline type modifier in mixed import — import { fn, type T } from 'mod' is valid, TS erases type-only specifiers
type DocumentSigningField = { id: string; type: 'signature' | 'initials' | 'date'; required: boolean };
declare function submitDocumentSignatures(docId: string, fields: DocumentSigningField[]): Promise<{ signedAt: Date }>;

export async function processDocumentSigningForm(
  documentId: string,
  allFields: DocumentSigningField[],
): Promise<void> {
  const requiredFields = allFields.filter((f) => f.required);
  await submitDocumentSignatures(documentId, requiredFields);
}

