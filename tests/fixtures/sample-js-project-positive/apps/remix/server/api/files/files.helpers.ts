
// Case-insensitive file extension match /\.pdf$/i — ASCII literal, unicode flag adds nothing.
export function isPdfFile(filename: string): boolean {
  return /\.pdf$/i.test(filename);
}

export function stripPdfExtension(filename: string): string {
  return filename.replace(/\.pdf$/i, '');
}



// PDF extension stripping /\.pdf$/ — ASCII literal, unicode flag adds nothing.
export function buildDownloadFilename(title: string, suffix: string): string {
  const baseTitle = title.replace(/\.pdf$/, '');
  return `${baseTitle}${suffix}`;
}



// File extension match /\.pdf$/ — ASCII literal, unicode flag unnecessary.
export function getFileBaseName(filename: string): string {
  if (/\.pdf$/.test(filename)) {
    return filename.slice(0, -4);
  }
  return filename;
}
