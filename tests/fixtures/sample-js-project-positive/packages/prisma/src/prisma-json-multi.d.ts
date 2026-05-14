
// --- redundant-type-alias FP: multiple aliases inside declare global { namespace PrismaJson } ---
declare global {
  namespace PrismaJson {
    type DocumentAuthOptions = { globalAccessAuth: string | null; globalActionAuth: string | null };
    type DocumentEmailSettings = { documentCompleted: boolean; recipientSigned: boolean };
    type DocumentEmailSettingsNullable = DocumentEmailSettings | null;
  }
}
