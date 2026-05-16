declare function detectSignatureFields(pageImage: Buffer): Promise<Array<{ x: number; y: number; w: number; h: number }>>;
declare function detectTextFields(pageImage: Buffer): Promise<Array<{ x: number; y: number; w: number; h: number }>>;

export async function detectAllFields(pageImages: Buffer[]) {
  const results = await Promise.all(
    pageImages.flatMap((img) => [
      detectSignatureFields(img),
      detectTextFields(img),
    ]),
  );
  return results;
}
