
// --- redundant-template-expression FP: template literal wrapping env() return for arg ---
declare function env(key: string): string | undefined;

async function getCloudfrontSignedUrl(objectKey: string, expiresIn: number): Promise<string> {
  const keyPairId = env('CF_KEY_PAIR_ID');
  const privateKey = env('CF_PRIVATE_KEY');
  const distributionDomain = env('CF_DISTRIBUTION_DOMAIN');

  const { getSignedUrl } = await import('@aws-sdk/cloudfront-signer' as any);

  return getSignedUrl({
    url: new URL(objectKey, `${distributionDomain}`).toString(),
    keyPairId: `${keyPairId}`,
    privateKey: `${privateKey}`,
    dateLessThan: new Date(Date.now() + expiresIn).toISOString(),
  });
}
