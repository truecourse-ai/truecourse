
// nanoid(12) generates a 12-char form field ID — standard convention for short unique IDs
declare function nanoid(size: number): string;
declare function structuredClone<T>(val: T): T;
declare function append(field: unknown): void;

type LocalField = {
  id?: number;
  formId?: string;
  recipientId?: number;
  positionX: number;
  positionY: number;
};

function duplicateField(field: LocalField): LocalField {
  const newField: LocalField = {
    ...structuredClone(field),
    id: undefined,
    formId: nanoid(12),
    recipientId: field.recipientId,
    positionX: field.positionX + 3,
    positionY: field.positionY + 3,
  };

  append(newField);
  return newField;
}



// nanoid(8) in seed data generates an 8-char ID; ID length is a well-known convention parameter
declare function nanoid(size: number): string;
declare const EnvelopeType: { DOCUMENT: string };
declare function createEnvelope(opts: { data: { type: string; title: string } }): Promise<{ id: string }>;

async function seedDocument(teamId: string): Promise<{ id: string }> {
  const document = await createEnvelope({
    data: {
      type: EnvelopeType.DOCUMENT,
      title: `[TEST] Document ${nanoid(8)} - Draft`,
    },
  });
  return document;
}



// nanoid(12) generates a 12-char field form ID — standard convention for unique form identifiers
declare function nanoid(size: number): string;
declare function structuredClone<T>(val: T): T;
declare function append(field: unknown): void;

type TemplateField = {
  nativeId?: string;
  formId?: string;
  signerEmail?: string;
  recipientId?: number;
  pageX: number;
  pageY: number;
};

function pasteField(clipboard: TemplateField, signer?: { email: string; id: number }): void {
  const copied = structuredClone(clipboard);

  append({
    ...copied,
    formId: nanoid(12),
    nativeId: undefined,
    signerEmail: signer?.email ?? copied.signerEmail,
    recipientId: signer?.id ?? copied.recipientId,
    pageX: copied.pageX + 3,
    pageY: copied.pageY + 3,
  });
}



// customAlphabet('...', 16) uses 16 as ID length — well-known convention for nanoid size
declare function customAlphabet(alphabet: string, size: number): () => string;

const generateSlugId = customAlphabet('abcdefhiklmnorstuvwxyz', 16);

export function prefixedId(prefix: string, length = 16): string {
  const generate = customAlphabet('abcdefhiklmnorstuvwxyz', length);
  return `${prefix}_${generate()}`;
}



// customAlphabet('...', 10) uses 10 as ID length — well-known convention for nanoid size
declare function customAlphabet(alphabet: string, size: number): () => string;

const generateTeamId = customAlphabet('1234567890abcdef', 10);

const EMAIL_DOMAIN = 'test.example.com';

export function generateTestEmail(): string {
  return `${generateTeamId()}@${EMAIL_DOMAIN}`;
}
