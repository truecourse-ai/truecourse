
declare function normalizePdf(opts: { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<{ fileId: string }>;
declare function insertFormValues(opts: { pdf: Buffer; formValues: Record<string, string> }): Promise<Buffer>;

type UploadInput = { file: File; payload: { title: string; formValues?: Record<string, string> } };

async function processDocumentUpload(input: UploadInput) {
  const { file, payload } = input;

  let pdf = Buffer.from(await file.arrayBuffer());

  if (payload.formValues) {
    pdf = await insertFormValues({
      pdf,
      formValues: payload.formValues,
    });
  }

  const { fileId } = await normalizePdf({
    name: file.name,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(pdf),
  });

  return { fileId, title: payload.title };
}


// Object.values(meta).length > 0 — Object.values returns any[]; length is number; comparison with 0 is valid
declare function updateEnvelopeMeta(opts: { envelopeId: number; meta: Record<string, unknown> }): Promise<void>;

export async function distributeEnvelope(
  envelopeId: number,
  meta: Record<string, unknown> = {},
): Promise<void> {
  if (Object.values(meta).length > 0) {
    await updateEnvelopeMeta({ envelopeId, meta });
  }
}

