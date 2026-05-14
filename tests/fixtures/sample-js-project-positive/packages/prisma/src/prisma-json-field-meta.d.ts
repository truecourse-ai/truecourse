
// --- redundant-type-alias FP: alias inside declare global { namespace PrismaJson } ---
declare global {
  namespace PrismaJson {
    type FieldMeta = {
      label?: string;
      placeholder?: string;
      required?: boolean;
      readOnly?: boolean;
    };
  }
}
