// LICENSE_SERVER_URL uses env override first, falling back to canonical production default.
declare function getEnv(key: string): string | undefined;
const LICENSE_SERVER_URL = getEnv('INTERNAL_OVERRIDE_LICENSE_SERVER_URL') ?? 'https://license.myapp.io';

async function validateLicense(key: string): Promise<boolean> {
  const res = await fetch(`${LICENSE_SERVER_URL}/validate`, {
    method: 'POST',
    body: JSON.stringify({ key }),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.ok;
}
