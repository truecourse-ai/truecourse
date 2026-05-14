// Email template: baseUrl default param is a preview-only fallback — real URL injected by caller.
function TeamRemovedEmail({ teamName, baseUrl = 'https://app.example.com' }: { teamName: string; baseUrl?: string }) {
  return (
    <div>
      <p>Your team <strong>{teamName}</strong> has been removed.</p>
      <a href={`${baseUrl}/dashboard`}>Go to Dashboard</a>
    </div>
  );
}
export { TeamRemovedEmail };
