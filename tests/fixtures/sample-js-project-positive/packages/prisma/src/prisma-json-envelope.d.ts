
// --- redundant-type-alias FP: aliases inside declare global { namespace PrismaJson } ---
declare global {
  namespace PrismaJson {
    type EnvelopeAttachmentType = 'original' | 'signed' | 'pending';
    type DocumentFormValues = Record<string, string | boolean | number>;
  }
}
