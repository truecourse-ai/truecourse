
declare const CONTENT_TYPE_JSON: string;
declare const CONTENT_TYPE_URLENCODED: string;

async function parseRequestBody(req: Request) {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes(CONTENT_TYPE_JSON)) {
    return { isValid: true, data: JSON.parse(await req.text()) };
  }

  if (contentType.includes(CONTENT_TYPE_URLENCODED)) {
    const raw = await req.text();
    const params = new URLSearchParams(raw);
    const data: Record<string, string> = {};
    params.forEach((v, k) => { data[k] = v; });
    return { isValid: true, data };
  }

  return { isValid: false, data: null };
}
