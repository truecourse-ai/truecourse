
declare function updateDocument(opts: { documentId: number; meta: Record<string, unknown> }): Promise<void>;
declare function setRecipients(opts: { documentId: number; recipients: unknown[] }): Promise<{ data: unknown[] }>;

type SignerSchema = { nativeId: number; actionAuth?: string[] };
type FormSchema = { signers: SignerSchema[]; signingOrder: string; allowDictateNextSigner: boolean };

async function onFormSubmit(data: FormSchema) {
  const documentId = 1;

  await Promise.all([
    updateDocument({
      documentId,
      meta: {
        allowDictateNextSigner: data.allowDictateNextSigner,
        signingOrder: data.signingOrder,
      },
    }),
    setRecipients({
      documentId,
      recipients: data.signers.map((signer) => ({
        ...signer,
        id: signer.nativeId,
        actionAuth: signer.actionAuth ?? [],
      })),
    }),
  ]);
}

async function onFormAutoSave(data: FormSchema) {
  const documentId = 1;

  const [, recipientsResponse] = await Promise.all([
    updateDocument({
      documentId,
      meta: {
        allowDictateNextSigner: data.allowDictateNextSigner,
        signingOrder: data.signingOrder,
      },
    }),
    setRecipients({
      documentId,
      recipients: data.signers.map((signer) => ({
        ...signer,
        id: signer.nativeId,
        actionAuth: signer.actionAuth ?? [],
      })),
    }),
  ]);

  return recipientsResponse;
}
