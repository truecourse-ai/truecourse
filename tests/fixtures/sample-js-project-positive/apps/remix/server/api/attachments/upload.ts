
// Pass-through: console.error('Upload failed:', error) with label, returns static error JSON
async function handleAttachmentUpload(req: UploadRequest): Promise<ApiResponse> {
  try {
    const result = await storeAttachment(req.file, req.metadata);
    return { success: true, fileId: result.id };
  } catch (error) {
    console.error('Upload failed:', error);
    return { success: false, error: 'Upload could not be completed' };
  }
}

interface UploadRequest { file: Uint8Array; metadata: Record<string, string>; }
interface ApiResponse { success: boolean; fileId?: string; error?: string; }
declare function storeAttachment(file: Uint8Array, meta: Record<string, string>): Promise<{ id: string }>;
