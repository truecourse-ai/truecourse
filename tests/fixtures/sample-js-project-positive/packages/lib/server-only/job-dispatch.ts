
// HMAC/webhook signature utility — bare sign() call, not a JWT library
declare const sign: (payload: unknown) => string;
declare const INTERNAL_WEBAPP_URL: () => string;

export async function submitJobToEndpoint(jobId: string, jobDefinitionId: string, data: unknown, isRetry?: boolean) {
  const endpoint = `${INTERNAL_WEBAPP_URL()}/api/jobs/${jobDefinitionId}/${jobId}`;
  const signature = sign(data);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Job-Id': jobId,
    'X-Job-Signature': signature,
  };

  if (isRetry) {
    headers['X-Job-Retry'] = '1';
  }

  await fetch(endpoint, {
    method: 'POST',
    body: JSON.stringify(data),
    headers,
  });
}
