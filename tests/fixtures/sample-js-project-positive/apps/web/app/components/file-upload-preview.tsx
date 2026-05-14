
// File size display helper — 1024 * 1024 is the universally known binary MB constant
declare const fileSize: number;

function formatUploadSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const displayLabel = fileSize
  ? `Custom ${(fileSize / (1024 * 1024)).toFixed(2)} MB file`
  : 'Default file';
