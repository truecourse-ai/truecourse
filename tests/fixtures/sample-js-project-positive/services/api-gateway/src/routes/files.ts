
// HTTP 304 in c.body(null, 304) is the standard Not Modified cache response status code
declare const c: { body(data: null, status: number): Response; req: { header(key: string): string | undefined }; json(body: unknown, status: number): Response };
declare function computeEtag(data: string): string;
declare const documentData: string;
declare const isDownload: boolean;

async function serveDocumentFile(): Promise<Response> {
  const etag = computeEtag(documentData);

  if (c.req.header('If-None-Match') === etag && !isDownload) {
    return c.body(null, 304);
  }

  return c.json({ data: documentData }, 200);
}
