// Discriminated union literal must appear at each call site — TypeScript narrowing requirement
type LoaderResult =
  | { status: 'InvalidLink'; message: string }
  | { status: 'Success'; inviterName: string; teamName: string };

async function loaderA(token: string): Promise<LoaderResult> {
  const invitation = await fetchInvitation(token);
  if (!invitation) {
    return { status: 'InvalidLink', message: 'Invitation not found or expired.' };
  }
  return { status: 'Success', inviterName: invitation.inviterName, teamName: invitation.teamName };
}

async function loaderB(token: string): Promise<LoaderResult> {
  const invitation = await fetchInvitation(token);
  if (!invitation?.isValid) {
    return { status: 'InvalidLink', message: 'Invitation link is no longer valid.' };
  }
  return { status: 'Success', inviterName: invitation.inviterName, teamName: invitation.teamName };
}

declare function fetchInvitation(token: string): Promise<{ inviterName: string; teamName: string; isValid: boolean } | null>;



// --- FP shape: Remix ErrorBoundary export (React component) returning JSX; trivially inferred. Framework convention ---
declare function useRouteError(): unknown;
declare function isRouteErrorResponse(err: unknown): err is { data: { type: string } };

export function ErrorBoundary() {
  return (
    <div>
      <h1>Authentication Portal Not Found</h1>
      <p>The page you are looking for does not exist.</p>
    </div>
  );
}



// --- FP shape: Remix ErrorBoundary export returning JSX; trivially inferred. Framework convention ---
declare function useRouteError2(): unknown;
declare function isRouteErrorResponse2(err: unknown): err is { data: { type: string } };
declare function match2(val: unknown): { with(s: string, fn: () => unknown): { otherwise(fn: () => unknown): unknown } };

export function SsoConfirmationErrorBoundary({ error }: { error?: unknown }) {
  const errorCode = isRouteErrorResponse2(error) ? error.data.type : 500;

  return (
    <div>
      <h1>SSO Confirmation Error</h1>
      <p>Error code: {String(errorCode)}</p>
    </div>
  );
}
