// Email template default param: 'https://app.example.com' is a preview-only fallback; real URL always injected by caller.
function ConfirmMembershipEmail({
  inviterName,
  teamName,
  confirmUrl,
  baseUrl = 'https://app.example.com',
}: {
  inviterName: string;
  teamName: string;
  confirmUrl: string;
  baseUrl?: string;
}) {
  return (
    <div>
      <p>{inviterName} invited you to join <strong>{teamName}</strong>.</p>
      <a href={confirmUrl}>Accept Invitation</a>
      <footer><a href={baseUrl}>Visit MyApp</a></footer>
    </div>
  );
}
export { ConfirmMembershipEmail };
