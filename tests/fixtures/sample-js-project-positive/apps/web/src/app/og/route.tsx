declare function loadFontAsset(name: string): Promise<ArrayBuffer>;
declare function loadImageAsset(name: string): Promise<ArrayBuffer>;

async function loadAssets() {
  const [fontBuffer, imageBuffer] = await Promise.all([
    loadFontAsset('Inter-Bold'),
    loadImageAsset('logo-white'),
  ]);
  return { fontBuffer, imageBuffer };
}

export async function GET() {
  const assets = await loadAssets();
  return new Response(JSON.stringify({ assetSizes: [assets.fontBuffer.byteLength, assets.imageBuffer.byteLength] }));
}
