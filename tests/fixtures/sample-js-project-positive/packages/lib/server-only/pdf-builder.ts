
declare const pdfLib: {
  load: (data: Uint8Array) => Promise<{
    getPageCount: () => number;
    copyPagesFrom: (src: unknown, indices: number[]) => Promise<void>;
  }>;
};

declare const certificateDocument: { getPageCount: () => number } | null;
declare const auditDocument: { getPageCount: () => number } | null;

async function buildFinalPdf(pdfData: Uint8Array) {
  const pdfDoc = await pdfLib.load(pdfData);

  if (certificateDocument) {
    await pdfDoc.copyPagesFrom(
      certificateDocument,
      Array.from({ length: certificateDocument.getPageCount() }, (_, index) => index),
    );
  }

  if (auditDocument) {
    await pdfDoc.copyPagesFrom(
      auditDocument,
      Array.from({ length: auditDocument.getPageCount() }, (_, index) => index),
    );
  }

  return pdfDoc;
}



// --- FP shape: for-of loop awaiting method on shared object (sequential page embedding) ---
declare const reportDoc: { embedPage(page: unknown): Promise<unknown>; save(): Promise<Uint8Array> };
declare const pageRefs: unknown[];

async function assembleReportPages(): Promise<Uint8Array> {
  for (const pageRef of pageRefs) {
    await reportDoc.embedPage(pageRef);
  }
  return reportDoc.save();
}



// --- FP shape: for-of loop awaiting function that mutates shared legacy PDF object ---
declare const legacyPdfDoc: object;
declare const formFields: Array<{ name: string; value: string; page: number }>;
declare function renderFieldInLegacyDoc(doc: object, field: { name: string; value: string; page: number }): Promise<void>;

async function stampLegacyFields(): Promise<void> {
  for (const field of formFields) {
    await renderFieldInLegacyDoc(legacyPdfDoc, field);
  }
}



// --- FP shape: for-of loop where await result is consumed later in same iteration ---
declare function fetchAttachmentBytes(id: string): Promise<Uint8Array>;
declare function processSignedAttachment(bytes: Uint8Array, meta: { id: string }): Promise<void>;
declare const attachments: Array<{ id: string }>;

async function processAttachments(): Promise<void> {
  for (const attachment of attachments) {
    const bytes = await fetchAttachmentBytes(attachment.id);
    await processSignedAttachment(bytes, attachment);
  }
}



// --- FP shape: final await in loop depends on multiple results produced earlier in same iteration ---
declare function loadEnvelopePdf(envelopeId: string): Promise<Uint8Array>;
declare function generateCertificatePdf(envelopeId: string): Promise<Uint8Array>;
declare function generateAuditPdf(envelopeId: string): Promise<Uint8Array>;
declare function finalizeSignedPdf(envelope: Uint8Array, cert: Uint8Array, audit: Uint8Array): Promise<Uint8Array>;
declare const pendingEnvelopes: Array<{ id: string }>;

async function sealPendingEnvelopes(): Promise<void> {
  for (const envelope of pendingEnvelopes) {
    const envelopePdf = await loadEnvelopePdf(envelope.id);
    const certPdf = await generateCertificatePdf(envelope.id);
    const auditPdf = await generateAuditPdf(envelope.id);
    await finalizeSignedPdf(envelopePdf, certPdf, auditPdf);
  }
}
