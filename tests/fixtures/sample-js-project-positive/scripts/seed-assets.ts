
// FP shape: Node.js fs.readFileSync with toString encoding; no type mismatch
declare const fs: { readFileSync: (path: string) => { toString: (encoding: string) => string } };
declare const path: { join: (...parts: string[]) => string };
declare const __dirname: string;

function loadAssetBase64(filename: string): string {
  return fs.readFileSync(path.join(__dirname, 'assets', filename)).toString('base64');
}
