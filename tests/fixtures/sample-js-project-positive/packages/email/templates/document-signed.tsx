
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



// Positive: filename-class-mismatch — document-signed.tsx exports DocumentSignedEmail (drops the
// 'Template' suffix vs function name DocumentSignedEmailTemplate). Minor suffix variation in email
// template naming is an intentional convention: the named function retains 'Template' for internal
// disambiguation while the exported name is the external-facing email class name.
export function DocumentSignedEmail({
  documentName,
  signerName,
}: {
  documentName: string;
  signerName: string;
}) {
  return (
    <div>
      <p>{signerName} has signed the document: {documentName}</p>
    </div>
  );
}

