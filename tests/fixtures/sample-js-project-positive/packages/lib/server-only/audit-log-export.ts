
// --- argument-type-mismatch shape: stdlib-and-third-party-api-calls (Buffer.from(Uint8Array).toString('base64')) ---
declare function generateAuditPdf(opts: {
  envelopeId: string;
  recipientEmails: string[];
  pageWidth: number;
  pageHeight: number;
}): Promise<{ save(): Promise<Uint8Array> }>;
const PDF_WIDTH = 595;
const PDF_HEIGHT = 842;

export async function exportAuditLogAsBase64(envelopeId: string, recipientEmails: string[]) {
  const auditPdf = await generateAuditPdf({
    envelopeId,
    recipientEmails,
    pageWidth: PDF_WIDTH,
    pageHeight: PDF_HEIGHT,
  });

  const result = await auditPdf.save();
  const base64 = Buffer.from(result).toString('base64');

  return { data: base64 };
}
