declare function fetchAuditLogEntries(docId: string): Promise<Array<{ action: string; actorId: string; timestamp: number }>>;
declare function fetchDocumentMetadata(docId: string): Promise<{ title: string; createdAt: number }>;

export async function generateAuditLogPdf(docId: string): Promise<Buffer> {
  const [entries, metadata] = await Promise.all([
    fetchAuditLogEntries(docId),
    fetchDocumentMetadata(docId),
  ]);
  // render to PDF
  return Buffer.from(`${metadata.title}: ${entries.length} entries`);
}
