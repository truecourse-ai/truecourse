
// FP: fetch call with object literal argument — not a complex expression
declare const apiEndpoint: string;
declare const requestHeaders: Record<string, string>;
declare const bodyPayload: string;

async function sendMailChannelsRequest() {
  const response = await fetch(apiEndpoint, {
    method: 'POST',
    headers: requestHeaders,
    body: bodyPayload,
  });
  return response;
}
