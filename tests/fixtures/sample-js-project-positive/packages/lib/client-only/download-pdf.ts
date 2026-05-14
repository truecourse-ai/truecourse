
declare function downloadFile(opts: { filename: string; data: Blob }): void;
declare function getFilePdfUrl(opts: { type: string; token: string }): string;

// PDF extension match /\.pdf$/ — ASCII literal, unicode flag unnecessary.
export async function downloadUserPdf(filename: string, token: string): Promise<void> {
  const url = getFilePdfUrl({ type: 'download', token });
  const blob = await fetch(url).then((r) => r.blob());
  const baseTitle = (filename ?? 'file').replace(/\.pdf$/, '');
  downloadFile({ filename: `${baseTitle}_signed.pdf`, data: blob });
}
