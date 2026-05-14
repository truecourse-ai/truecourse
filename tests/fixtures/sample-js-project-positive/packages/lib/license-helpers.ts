
declare function fetchLicenseInfo(licenseKey: string): Promise<{ valid: boolean; expiresAt: Date }>;

async function validateLicense(licenseKey: string): Promise<{ valid: boolean; expiresAt: Date } | null> {
  try {
    return await fetchLicenseInfo(licenseKey);
  } catch (err) {
    console.warn('License check failed — treating as unlicensed');
    console.error(err);
    return null;
  }
}
