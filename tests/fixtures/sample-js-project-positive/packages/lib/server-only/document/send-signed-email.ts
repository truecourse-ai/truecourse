// Single function appends '.pdf' suffix conditionally — one usage
function buildAttachmentFilename(baseName: string, includeExtension: boolean): string {
  if (!includeExtension) return baseName;
  return baseName.endsWith('.pdf') ? baseName : `${baseName}.pdf`;
}
