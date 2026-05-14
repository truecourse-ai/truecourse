
// Case-insensitive file extension match /\.pdf$/i — ASCII literal, unicode flag adds nothing.
export function isPdfFile(filename: string): boolean {
  return /\.pdf$/i.test(filename);
}

export function stripPdfExtension(filename: string): string {
  return filename.replace(/\.pdf$/i, '');
}



// PDF extension stripping /\.pdf$/ — ASCII literal, unicode flag adds nothing.
export function buildDownloadFilename(title: string, suffix: string): string {
  const baseTitle = title.replace(/\.pdf$/, '');
  return `${baseTitle}${suffix}`;
}



// File extension match /\.pdf$/ — ASCII literal, unicode flag unnecessary.
export function getFileBaseName(filename: string): string {
  if (/\.pdf$/.test(filename)) {
    return filename.slice(0, -4);
  }
  return filename;
}


// Shape: String.prototype.includes() with a string constant — no argument type mismatch
const CONTENT_TYPE_MULTIPART_FORM = 'multipart/form-data';

export function isMultipartRequest(contentType: string): boolean {
  return contentType.includes(CONTENT_TYPE_MULTIPART_FORM);
}



// Shape: async arrow returning Promise.resolve(buffer) as arrayBuffer field — valid typed call
declare function storeEnvelopeFile(
  opts: { name: string; type: string; arrayBuffer: () => Promise<Uint8Array> },
  originalDataId?: string,
): Promise<{ documentData: { id: string } }>;

export async function uploadSealedEnvelope(
  envelopeTitle: string,
  sealedBytes: Uint8Array,
  originalDataId: string,
): Promise<string> {
  const { documentData } = await storeEnvelopeFile(
    {
      name: `${envelopeTitle}_sealed.pdf`,
      type: 'application/pdf',
      arrayBuffer: async () => Promise.resolve(sealedBytes),
    },
    originalDataId,
  );
  return documentData.id;
}



// Shape: Object.assign to attach signature data to a field record — intentional escape hatch
declare const updatedField: { id: string; type: string; pageNumber: number };
declare const signatureData: { signatureImageBase64: string; signatureType: string };

// Dirty but I don't want to deal with type information here
Object.assign(updatedField, { signatureData });



// Shape: Array.find with id equality — senderId is string | null | undefined; no type mismatch
declare const authorizedSenders: Array<{ id: string; email: string; displayName: string }>;

export function resolveSenderById(
  senderId: string | null | undefined,
): { id: string; email: string; displayName: string } | undefined {
  return authorizedSenders.find((sender) => sender.id === senderId);
}



// Shape: Object.entries destructuring in for...of — correctly typed [string, T][] entries
type SignaturesByPage = Record<string, Array<{ id: string; type: string; pageX: number; pageY: number }>>;

export async function applySignaturesToPages(
  signaturesByPage: SignaturesByPage,
  applyFn: (pageNumber: string, sig: { id: string; type: string; pageX: number; pageY: number }) => Promise<void>,
): Promise<void> {
  for (const [pageNumber, signatures] of Object.entries(signaturesByPage)) {
    for (const signature of signatures) {
      await applyFn(pageNumber, signature);
    }
  }
}



// Shape: Object.values/keys on typed objects to check emptiness — no type mismatch
export function isEnvelopeUpdateNoop(
  fieldsUpdate: Record<string, unknown>,
  metaUpdate: Record<string, string>,
): boolean {
  return Object.values(fieldsUpdate).length === 0 && Object.keys(metaUpdate).length === 0;
}



// Shape: string split/filter on attachment filename — correctly typed, no mismatch
declare function fetchEnvelopeAttachment(opts: { storageType: string; dataKey: string }): Promise<Buffer>;

export async function loadEnvelopeAttachmentBytes(
  attachment: { storageType: string; dataKey: string; filename: string },
): Promise<Buffer | null> {
  return fetchEnvelopeAttachment({
    storageType: attachment.storageType,
    dataKey: attachment.dataKey,
  }).catch((err: unknown) => {
    console.error('Failed to load attachment:', err);
    return null;
  });
}



// Shape: Promise.all with async map — standard parallel upload pattern, no type mismatch
declare function storeEnvelopeAttachment(
  attachment: { name: string; size: number; mimeType: string },
): Promise<{ storageId: string; publicUrl: string }>;

export async function uploadEnvelopeAttachments(
  attachments: Array<{ name: string; size: number; mimeType: string }>,
): Promise<Array<{ name: string; storageId: string; url: string }>> {
  return Promise.all(
    attachments.map(async (attachment) => {
      const { storageId, publicUrl } = await storeEnvelopeAttachment(attachment);
      return {
        name: attachment.name,
        storageId,
        url: publicUrl,
      };
    }),
  );
}



// Shape: array.map((item) => item.property) — property extraction, correct types, no mismatch
declare const envelope: {
  items: Array<{ id: string; title: string; pageCount: number }>;
};

export function getEnvelopeItemTitles(): string[] {
  return envelope.items.map((item) => item.title);
}



// Shape: typed function call with async arrayBuffer lambda — valid typed call, no mismatch
interface EnvelopeFileUploadInput {
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}
declare function putEnvelopeFileServerSide(input: EnvelopeFileUploadInput): Promise<{ publicUrl: string }>;

export async function storeEnvelopePdfFromTemplate(
  templateTitle: string,
  pdfBytes: Uint8Array,
): Promise<string> {
  const result = await putEnvelopeFileServerSide({
    name: `${templateTitle}.pdf`,
    type: 'application/pdf',
    arrayBuffer: async () => pdfBytes.buffer as ArrayBuffer,
  });
  return result.publicUrl;
}



// argument-type-mismatch: typed helper function called with wrong argument type — genuine TS error
function formatAttachmentSize(bytes: number, decimalPlaces: number): string {
  return (bytes / 1024).toFixed(decimalPlaces);
}
// TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
const _formatted = formatAttachmentSize('1024kb', 2);

