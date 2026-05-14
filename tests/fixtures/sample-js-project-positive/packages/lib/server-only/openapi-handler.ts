
const CONTENT_TYPE_JSON = 'application/json';
const CONTENT_TYPE_URLENCODED = 'application/x-www-form-urlencoded';
const CONTENT_TYPE_MULTIPART = 'multipart/form-data';

async function parseRequestBody(req: Request): Promise<{ isValid: boolean; data: unknown }> {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes(CONTENT_TYPE_JSON)) {
    return {
      isValid: true,
      data: JSON.parse(await req.text()),
    };
  }

  if (contentType.includes(CONTENT_TYPE_URLENCODED)) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    return {
      isValid: true,
      data: Object.fromEntries(params.entries()),
    };
  }

  if (contentType.includes(CONTENT_TYPE_MULTIPART)) {
    const formData = await req.formData();
    return {
      isValid: true,
      data: Object.fromEntries(formData.entries()),
    };
  }

  return {
    isValid: true,
    data: req.body,
  };
}



// FP shape fb5aa49f5134: Proxy intercepting url/body/headers on a Request object — no type mismatch
declare const CONTENT_TYPE_MULTIPART: string;

const createRequestProxy = async (req: Request, url?: string): Promise<Request> => {
  const originalContentType = req.headers.get('content-type') || '';
  const isMultipart = originalContentType.includes(CONTENT_TYPE_MULTIPART);
  const body = isMultipart ? await req.formData() : await req.json().catch(() => null);

  return new Proxy(req, {
    get: (target, prop) => {
      switch (prop) {
        case 'url':
          return url ?? target.url;
        case 'body': {
          if (!body) {
            return target.body;
          }
          return JSON.stringify(body);
        }
        default:
          return (target as any)[prop];
      }
    },
  });
};
