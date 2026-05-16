declare const fs: { readFile: (path: string, enc: string) => Promise<string>; writeFile: (path: string, data: string, enc: string) => Promise<void> };
declare const path: { join: (...parts: string[]) => string };
declare const os: { tmpdir: () => string };
declare function generateNodeId(): string;

const NODE_ID_FILE = 'node-id.txt';

export async function getOrCreateNodeId(): Promise<string | null> {
  const filePath = path.join(os.tmpdir(), NODE_ID_FILE);

  try {
    const existingId = await fs.readFile(filePath, 'utf-8');

    // Returns a synchronous string value — no Promise returned, missing-return-await does not apply.
    if (existingId.trim()) {
      return existingId.trim();
    }
  } catch {
    // File doesn't exist or can't be read
  }

  const nodeId = generateNodeId();

  try {
    await fs.writeFile(filePath, nodeId, 'utf-8');
  } catch {
    // Ignore write errors
  }

  return nodeId;
}
