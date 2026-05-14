// downloadLink default param is for preview/Storybook only; real URL injected by caller.
function ContractCompletedEmail({
  recipientName,
  contractTitle,
  downloadLink = 'https://app.example.com/contracts/preview/download',
}: {
  recipientName: string;
  contractTitle: string;
  downloadLink?: string;
}) {
  return (
    <div>
      <p>Hi {recipientName},</p>
      <p>Your contract "{contractTitle}" is complete.</p>
      <a href={downloadLink}>Download PDF</a>
    </div>
  );
}
export { ContractCompletedEmail };
