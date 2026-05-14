
// --- redundant-template-expression FP: template literal on env() returning string|undefined ---
// env() returns string|undefined; wrapping in template coerces undefined → 'undefined' string
declare function env(key: string): string | undefined;
declare const ONE_HOUR: number;

async function getPresignedUploadUrl(key: string): Promise<{ key: string; url: string }> {
  const distributionDomain = env('UPLOAD_DISTRIBUTION_DOMAIN');
  const keyId = env('UPLOAD_DISTRIBUTION_KEY_ID');
  const keyContents = env('UPLOAD_DISTRIBUTION_KEY_CONTENTS');

  if (distributionDomain) {
    const distributionUrl = new URL(key, `${distributionDomain}`);
    const signedUrl = await generateSignedUrl({
      url: distributionUrl.toString(),
      keyPairId: `${keyId}`,
      privateKey: `${keyContents}`,
      expiresIn: ONE_HOUR,
    });
    return { key, url: signedUrl };
  }

  return { key, url: `/files/${key}` };
}

declare function generateSignedUrl(opts: { url: string; keyPairId: string; privateKey: string; expiresIn: number }): Promise<string>;
