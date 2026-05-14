declare function fetchDocumentById(docId: string): Promise<{ id: string; title: string }>;
declare function fetchDocumentSignatures(docId: string): Promise<Array<{ signerId: string }>>;

export async function run(payload: { documentId: string }) {
  const [document, signatures] = await Promise.all([
    fetchDocumentById(payload.documentId),
    fetchDocumentSignatures(payload.documentId),
  ]);
  console.log(`Sealing ${document.title} with ${signatures.length} signatures`);
}
