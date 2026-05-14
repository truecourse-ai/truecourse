
// Shape: async map with ORM findFirst call inside
declare const db: { assetData: { findFirst(opts: { where: { id: string } }): Promise<{ id: string; content: string } | null> } };
interface UploadItem { assetDataId: string; label: string; }
declare const uploadItems: UploadItem[];

async function resolveUploadItems(uploadItems: UploadItem[]) {
  const resolvedItems = await Promise.all(
    uploadItems.map(async (item) => {
      const assetData = await db.assetData.findFirst({
        where: {
          id: item.assetDataId,
        },
      });
      return { ...item, assetData };
    }),
  );
  return resolvedItems;
}



// Shape: array.map(async (item) => {...}) in Promise.all — correct async map pattern, no type mismatch
declare const testFields: Array<{ id: string; type: string; value: string }>;
declare function generateFieldReport(field: { id: string; type: string; value: string }): Promise<{ fieldId: string; report: string }>;

export async function buildFieldReports(): Promise<Array<{ fieldId: string; report: string }>> {
  return Promise.all(
    testFields.map(async (field) => {
      const report = await generateFieldReport(field);
      return report;
    }),
  );
}



// Shape: sharp(Buffer.from(svgString)) — Buffer.from(string) accepted by image processor, no type mismatch
declare function imageProcessor(input: Buffer): { toFormat: (fmt: string) => { toBuffer: () => Promise<Buffer> } };

export async function convertSvgToPng(svg: string): Promise<Buffer> {
  return imageProcessor(Buffer.from(svg)).toFormat('png').toBuffer();
}



// --- FP shape: sequential LLM calls where each chunk prompt includes accumulated prior results ---
declare function callLlmWithContext(
  chunk: string,
  previousResults: Array<{ email: string; role: string }>
): Promise<Array<{ email: string; role: string }>>;
declare const textChunks: string[];

async function detectRecipientsChunked(): Promise<Array<{ email: string; role: string }>> {
  let allRecipients: Array<{ email: string; role: string }> = [];
  for (const chunk of textChunks) {
    const detected = await callLlmWithContext(chunk, allRecipients);
    allRecipients = [...allRecipients, ...detected];
  }
  return allRecipients;
}
