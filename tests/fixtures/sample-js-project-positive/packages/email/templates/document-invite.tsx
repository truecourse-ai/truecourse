// Default parameter values for email template preview/Storybook — real URLs injected by caller.
function DocumentInviteEmail({
  senderName,
  documentTitle,
  signUrl = 'https://app.example.com/sign/preview',
  reviewUrl = 'https://app.example.com/review/preview',
}: {
  senderName: string;
  documentTitle: string;
  signUrl?: string;
  reviewUrl?: string;
}) {
  return (
    <div>
      <p>{senderName} invited you to sign: {documentTitle}</p>
      <a href={signUrl}>Sign Now</a>
      <a href={reviewUrl}>Review First</a>
    </div>
  );
}
export { DocumentInviteEmail };
