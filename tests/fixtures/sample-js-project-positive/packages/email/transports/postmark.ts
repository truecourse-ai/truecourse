// MailChannels / Postmark API endpoint is the canonical documented endpoint for the service;
// callers can override it via options, so the default is a safe, intentional fallback.
declare type TransportOptions = { apiKey: string; endpoint?: string };
function createPostmarkTransport(options: TransportOptions) {
  const endpoint = options.endpoint ?? 'https://api.postmarkapp.com/email';
  return { endpoint, apiKey: options.apiKey };
}
