
declare function getEnvVar(key: string): string;
declare const fileKey: string;

async function getPresignedCdnUrl(fileKey: string): Promise<{ url: string }> {
  const distributionDomain = getEnvVar('CDN_DISTRIBUTION_DOMAIN');

  if (distributionDomain) {
    const { getSignedCdnUrl } = await import('@cdn-provider/signer');
    const url = getSignedCdnUrl({
      url: new URL(fileKey, distributionDomain).toString(),
      keyPairId: getEnvVar('CDN_KEY_PAIR_ID'),
      privateKey: getEnvVar('CDN_PRIVATE_KEY'),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    return { url };
  }

  return { url: `https://storage.example.com/${fileKey}` };
}
