
// Split warn+error pattern: console.warn with context string immediately before console.error with error object
async function fetchLicenseFromServer(serverUrl: string): Promise<LicenseData | null> {
  try {
    return await getLicenseFromServer(serverUrl);
  } catch (err) {
    console.warn('[License] License server not responding, using cached license.');
    console.error(err);
    return getCachedLicense();
  }
}

interface LicenseData { key: string; expiresAt: string; features: string[]; }
declare function getLicenseFromServer(url: string): Promise<LicenseData>;
declare function getCachedLicense(): LicenseData | null;
