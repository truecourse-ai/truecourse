
// --- react-readonly-props FP: optional string primitive props in email template ---
interface DocumentSignedEmailTemplateProps {
  documentName?: string;
  recipientName?: string;
  recipientEmail?: string;
  assetBaseUrl?: string;
}

function DocumentSignedEmailTemplate({
  documentName = 'Agreement.pdf',
  recipientName = 'Jane Smith',
  recipientEmail = 'jane@example.com',
  assetBaseUrl = 'http://localhost:3000',
}: DocumentSignedEmailTemplateProps) {
  return (
    <div>
      <p>Document: {documentName}</p>
      <p>Signed by: {recipientName} ({recipientEmail})</p>
    </div>
  );
}
