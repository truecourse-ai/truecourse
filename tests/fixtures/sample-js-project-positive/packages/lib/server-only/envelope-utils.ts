
// Typed function call with typed object argument (await)
declare interface EnvelopeCreateInput { title: string; externalId?: string; recipients: Array<{ email: string; name: string; role: string }>; }
declare interface Envelope { id: string; title: string; status: string; }
declare function createEnvelope(input: EnvelopeCreateInput): Promise<Envelope>;

async function buildAndCreateEnvelope(title: string, recipientEmail: string): Promise<Envelope> {
  const envelope = await createEnvelope({
    title,
    externalId: undefined,
    recipients: [{ email: recipientEmail, name: '', role: 'SIGNER' }],
  });
  return envelope;
}



// FP shape fb45706ded7f: conditional title handling and putPdfFile call — no type mismatch
declare function putPdfFileServerSide(opts: { name: string; type: string; arrayBuffer: () => Promise<Buffer> }): Promise<{ documentData: { id: string } }>;
declare const normalizedPdf: Buffer;
declare const sourceItem: { title?: string; order: number };
declare const envelopeTitle: string;

async function prepareEnvelopeItem() {
  const titleToUse = sourceItem.title || envelopeTitle;

  const { documentData: newDocumentData } = await putPdfFileServerSide({
    name: titleToUse,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(normalizedPdf),
  });

  return {
    title: titleToUse.endsWith('.pdf') ? titleToUse.slice(0, -4) : titleToUse,
    documentDataId: newDocumentData.id,
    order: sourceItem.order,
  };
}
