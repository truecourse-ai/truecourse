// Single seed file reads a file and converts to 'base64' — one usage
declare const fs: {
  readFileSync(path: string): Buffer;
};

function loadSeedDocument(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return buffer.toString('base64');
}
