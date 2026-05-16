declare function createTransport(opts: any): any;
declare function env(key: string): string | undefined;

const buildSmtpTransport = () => {
  return createTransport({
    host: env('SMTP_HOST') ?? '127.0.0.1',
    port: Number(env('SMTP_PORT')) || 587,
    secure: env('SMTP_SECURE') === 'true',
    auth: env('SMTP_USERNAME')
      ? {
          user: env('SMTP_USERNAME'),
          pass: env('SMTP_PASSWORD') ?? '',
        }
      : undefined,
  });
};


// hardcoded-url FP: 'https://app.truecourse.io' is a default prop value for email template previews;
// the real URL is always injected by the caller at runtime — this is a safe preview-only fallback
function TeamInvitationEmail({
  inviterName,
  workspaceName,
  acceptUrl,
  appBaseUrl = 'https://app.truecourse.io',
}: {
  inviterName: string;
  workspaceName: string;
  acceptUrl: string;
  appBaseUrl?: string;
}) {
  return `
    <div>
      <p>${inviterName} invited you to join ${workspaceName}.</p>
      <a href="${acceptUrl}">Accept Invitation</a>
      <footer><a href="${appBaseUrl}">Open App</a></footer>
    </div>
  `;
}

export { TeamInvitationEmail };

