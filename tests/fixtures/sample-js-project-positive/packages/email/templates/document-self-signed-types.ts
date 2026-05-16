
// --- redundant-type-alias FP: exported alias providing public API contract ---
interface SelfSignedEmailProps {
  documentName?: string;
  assetBaseUrl?: string;
  recipientName?: string;
}

// Exported alias: public contract for consumers of this email template module
export type DocumentSelfSignedTemplateProps = SelfSignedEmailProps;

declare function renderEmailTemplate(props: DocumentSelfSignedTemplateProps): string;
