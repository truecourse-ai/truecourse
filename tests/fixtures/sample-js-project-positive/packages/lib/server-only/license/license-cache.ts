interface CachedLicense { tier: string; features: string[] }
declare const ZCachedLicenseSchema: { parse: (data: unknown) => CachedLicense };
declare const fs: { readFile: (path: string, enc: string) => Promise<string> };
declare const path: { join: (...parts: string[]) => string };

const LICENSE_FILE = '.license.json';

export async function loadLicenseFromFile(): Promise<CachedLicense | null> {
  const filePath = path.join(process.cwd(), LICENSE_FILE);

  try {
    const fileContents = await fs.readFile(filePath, 'utf-8');

    // Returns synchronous ZCachedLicenseSchema.parse(JSON.parse(fileContents)) — no Promise involved.
    // missing-return-await does not apply here.
    return ZCachedLicenseSchema.parse(JSON.parse(fileContents));
  } catch {
    return null;
  }
}
