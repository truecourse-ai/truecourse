
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


// FP: typed object argument to file storage function — no type mismatch
interface AttachmentUploadParams {
  name: string;
  type: string;
  data: Buffer;
  size: number;
}
interface StorageResult { id: string; url: string }
declare function putAttachmentServerSide(params: AttachmentUploadParams): Promise<StorageResult>;

export async function storeGeneratedReport(
  fileName: string,
  reportBuffer: Buffer,
): Promise<StorageResult> {
  return putAttachmentServerSide({
    name: fileName,
    type: 'application/pdf',
    data: reportBuffer,
    size: reportBuffer.length,
  });
}



// FP: Buffer.from(await file.arrayBuffer()) — file is typed as File (Web API),
// arrayBuffer() returns Promise<ArrayBuffer>, Buffer.from() accepts ArrayBuffer.
// Standard Node.js conversion pattern; no argument type mismatch.
declare function normalizeAttachment(buffer: Buffer, opts?: { flatten?: boolean }): Promise<Buffer>;

export async function uploadNormalizedAttachment(
  file: File,
  options: { flatten?: boolean } = {},
): Promise<{ id: string; url: string }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const normalized = await normalizeAttachment(buffer, options);
  const fileName = file.name.endsWith('.pdf') ? file.name : `${file.name}.pdf`;

  return storeAttachmentServerSide({
    name: fileName,
    type: 'application/pdf',
    data: normalized,
    size: normalized.length,
  });
}

declare function storeAttachmentServerSide(params: {
  name: string;
  type: string;
  data: Buffer;
  size: number;
}): Promise<{ id: string; url: string }>;



// FP shape: standard HTTP error message in a Hono handler JSON response — 'Not found'
// is the well-known reason phrase, not an arbitrary magic string.
declare const honoCtx: {
  json: (body: unknown, status: number) => Response;
  req: { header: (name: string) => string | undefined; param: (name: string) => string };
};
declare function lookupAttachment(id: string, authToken: string): Promise<{ url: string } | null>;

async function getAttachmentByIdRoute(): Promise<Response> {
  const authToken = honoCtx.req.header('Authorization');
  if (!authToken) {
    return honoCtx.json({ error: 'Not found' }, 404);
  }
  const attachmentId = honoCtx.req.param('attachmentId');
  const attachment = await lookupAttachment(attachmentId, authToken);
  if (!attachment) {
    return honoCtx.json({ error: 'Not found' }, 404);
  }
  return honoCtx.json({ url: attachment.url }, 200);
}



// magic-string shape: 'Not found' HTTP error message literal repeated 3+ times in route handlers
declare const honoCtx2: {
  json: (body: unknown, status?: number) => Response;
  req: { param: (k: string) => string; header: (k: string) => string | undefined };
};
declare function lookupFileRecord(id: string): Promise<{ url: string; size: number } | null>;
declare function checkFileAccess(fileId: string, userId: string): Promise<boolean>;

async function getFileByIdHandler(): Promise<Response> {
  const fileId = honoCtx2.req.param('fileId');
  const userId = honoCtx2.req.header('x-user-id');
  if (!userId) return honoCtx2.json({ error: 'Not found' }, 404);
  const hasAccess = await checkFileAccess(fileId, userId);
  if (!hasAccess) return honoCtx2.json({ error: 'Not found' }, 404);
  const record = await lookupFileRecord(fileId);
  if (!record) return honoCtx2.json({ error: 'Not found' }, 404);
  return honoCtx2.json({ url: record.url, size: record.size });
}

