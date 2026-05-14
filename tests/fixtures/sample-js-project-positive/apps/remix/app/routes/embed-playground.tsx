
// typeof guard to validate API response field is a string — type assertion, not secret comparison
declare const fetchPresignToken: (apiToken: string) => Promise<unknown>;

export async function exchangeApiToken(apiToken: string): Promise<string> {
  const data = await fetchPresignToken(apiToken);
  const presignToken = (data as Record<string, unknown>)?.token;

  if (!presignToken || typeof presignToken !== 'string') {
    throw new Error(`Unexpected response shape: ${JSON.stringify(data)}`);
  }

  return presignToken;
}
