
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


// redundant-type-alias FP: alias inside declare global { namespace PrismaJson } is required
// by prisma-json-types-generator for JSON column type binding.
declare global {
  namespace PrismaJson {
    type ReportColumnConfig = {
      key: string;
      label?: string;
      width?: number;
      sortable?: boolean;
      hidden?: boolean;
    };
  }
}

