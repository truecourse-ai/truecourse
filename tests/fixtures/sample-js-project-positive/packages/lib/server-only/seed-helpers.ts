
// Buffer.toString('base64') — standard encoding conversion, not a magic string
declare const fs: { readFileSync: (path: string) => Buffer };
declare const path: { join: (...parts: string[]) => string };

function loadAssetAsBase64(assetPath: string): string {
  return fs.readFileSync(path.join(__dirname, assetPath)).toString('base64');
}
