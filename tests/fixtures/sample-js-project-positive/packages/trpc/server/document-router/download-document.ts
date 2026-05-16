
// Pass-through via object shorthand: logger.error({error}) passes error as object property value
interface Logger { error(obj: Record<string, unknown>): void; }
declare const requestLogger: Logger;

class ServiceError extends Error {
  constructor(public code: string, msg: string) { super(msg); this.name = 'ServiceError'; }
}

declare function fetchDocumentBytes(docId: string, token: string): Promise<Uint8Array>;

async function downloadDocumentContent(docId: string, accessToken: string): Promise<Uint8Array> {
  try {
    return await fetchDocumentBytes(docId, accessToken);
  } catch (error) {
    requestLogger.error({ error });
    throw new ServiceError('DOWNLOAD_FAILED', 'Unable to retrieve document content');
  }
}
