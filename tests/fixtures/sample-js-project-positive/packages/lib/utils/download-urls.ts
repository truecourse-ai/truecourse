
// --- redundant-optional FP: prop?: undefined in discriminated union arm ---
// This is intentional: it explicitly blocks the prop in the 'download' variant
type DownloadUrlOptions =
  | {
      type: 'download';
      fileId: string;
      token: string | undefined;
      version: 'original' | 'signed';
      presignToken?: undefined;
    }
  | {
      type: 'view';
      fileId: string;
      token: string | undefined;
      presignToken?: string | undefined;
    };

function getFileDownloadUrl(options: DownloadUrlOptions): string {
  if (options.type === 'download') {
    return `/files/${options.fileId}/download?version=${options.version}`;
  }
  const tokenParam = options.presignToken ? `&presign=${options.presignToken}` : '';
  return `/files/${options.fileId}/view${tokenParam}`;
}
