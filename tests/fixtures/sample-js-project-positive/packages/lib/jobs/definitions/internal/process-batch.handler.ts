
declare function renderPdf(data: unknown): Promise<Uint8Array>;
declare function uploadToStorage(name: string, buf: Uint8Array): Promise<string>;
declare const batchItems: Array<{ id: string; data: unknown; documentId: string; locale: string }>;

async function processBatch() {
  const results: string[] = [];
  for (const item of batchItems) {
    const makeReceiptPdf = async () => {
      const buf = await renderPdf(item.data);
      return uploadToStorage(`receipt-${item.id}.pdf`, buf);
    };
    const makeSummaryPdf = async () => {
      const buf = await renderPdf({ id: item.documentId, locale: item.locale });
      return uploadToStorage(`summary-${item.id}.pdf`, buf);
    };
    const [receiptUrl, summaryUrl] = await Promise.all([makeReceiptPdf(), makeSummaryPdf()]);
    results.push(receiptUrl, summaryUrl);
  }
  return results;
}



declare function generateAuditReport(entry: unknown): Promise<Uint8Array>;
declare function persistFile(path: string, data: Uint8Array): Promise<string>;
declare const auditEntries: Array<{ id: string; payload: unknown; userId: string; timestamp: number }>;

async function processAuditBatch() {
  const urls: string[] = [];
  for (const entry of auditEntries) {
    const makeAuditLogPdf = async () => {
      const bytes = await generateAuditReport(entry.payload);
      return persistFile(`audit-${entry.id}.pdf`, bytes);
    };
    const makeReceiptPdf = async () => {
      const bytes = await generateAuditReport({ userId: entry.userId, ts: entry.timestamp });
      return persistFile(`receipt-${entry.id}.pdf`, bytes);
    };
    const [auditUrl, receiptUrl] = await Promise.all([makeAuditLogPdf(), makeReceiptPdf()]);
    urls.push(auditUrl, receiptUrl);
  }
  return urls;
}
