
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


// argument-type-mismatch FP: path.join(process.cwd(), 'public/...') — two string args, types match
import path from 'path';
import fs from 'fs';

function loadBrandLogo(): Buffer {
  const logoPath = path.join(process.cwd(), 'public/assets/brand-logo.png');
  return fs.readFileSync(logoPath);
}

function loadWatermarkImage(): Buffer {
  const watermarkPath = path.join(process.cwd(), 'public/assets/watermark.png');
  return fs.readFileSync(watermarkPath);
}

