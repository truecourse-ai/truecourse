declare function deleteDocumentSignatures(docId: string): Promise<void>;
declare function deleteDocumentFields(docId: string): Promise<void>;
declare function deleteDocumentAuditLog(docId: string): Promise<void>;

export async function adminDeleteDocument(docId: string) {
  await Promise.all([
    deleteDocumentSignatures(docId),
    await Promise.all([
      deleteDocumentFields(docId),
      deleteDocumentAuditLog(docId),
    ]),
  ]);
}
