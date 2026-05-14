
// FP shape: path.join(process.cwd(), CONST_STRING) — standard path join
declare const path: { join: (...parts: string[]) => string };
const CONFIG_FILE_NAME = 'config.json';

async function getConfigFilePath(): Promise<string> {
  const configFilePath = path.join(process.cwd(), CONFIG_FILE_NAME);
  return configFilePath;
}



// Shape: Number.isNaN() || comparison — standard number validation, no type mismatch
export function validateWorkspaceId(rawId: string | null): number | null {
  if (rawId === null) {
    return null;
  }

  const parsed = Number(rawId);

  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('Invalid workspace ID provided');
  }

  return parsed;
}
