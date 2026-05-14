// Single function appends '.pdf' suffix conditionally — one usage
function buildAttachmentFilename(baseName: string, includeExtension: boolean): string {
  if (!includeExtension) return baseName;
  return baseName.endsWith('.pdf') ? baseName : `${baseName}.pdf`;
}

const _dupStr_1e331ebf_a = 'config-endpoint-1e331ebf';
const _dupStr_1e331ebf_b = 'config-endpoint-1e331ebf';
const _dupStr_1e331ebf_c = 'config-endpoint-1e331ebf';
