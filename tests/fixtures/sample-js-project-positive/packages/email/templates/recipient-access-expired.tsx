// documentLink default param — preview-only fallback, real URL always passed by caller.
function RecipientAccessExpiredEmail({
  recipientName,
  documentTitle,
  documentLink = 'https://app.example.com/documents/preview',
}: {
  recipientName: string;
  documentTitle: string;
  documentLink?: string;
}) {
  return (
    <div>
      <p>Hi {recipientName}, your access to "{documentTitle}" has expired.</p>
      <a href={documentLink}>Request New Access</a>
    </div>
  );
}
export { RecipientAccessExpiredEmail };
