
// Shape: fluent image processing API call chain — no type mismatch
declare const sharp: (input: Buffer | string) => {
  resize(width: number, height: number): {
    png(): { toBuffer(): Promise<Buffer> };
    jpeg(opts?: { quality: number }): { toBuffer(): Promise<Buffer> };
  };
};

async function generateThumbnail(imagePath: string): Promise<Buffer> {
  return sharp(imagePath).resize(200, 200).png().toBuffer();
}

async function generatePreview(imageBuffer: Buffer, quality: number): Promise<Buffer> {
  return sharp(imageBuffer).resize(800, 600).jpeg({ quality }).toBuffer();
}
