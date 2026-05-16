
declare const signedPdfBytes: Uint8Array;
declare const documentTitle: string;
declare function uploadFileServerSide(opts: { name: string; type: string; arrayBuffer: () => Promise<Uint8Array> }, originalDataId?: string): Promise<{ documentData: { id: string } }>;

async function uploadSignedDocument(originalDataId: string) {
  const { documentData } = await uploadFileServerSide(
    {
      name: `${documentTitle}_signed.pdf`,
      type: 'application/pdf',
      arrayBuffer: async () => Promise.resolve(signedPdfBytes),
    },
    originalDataId,
  );
  return documentData.id;
}
