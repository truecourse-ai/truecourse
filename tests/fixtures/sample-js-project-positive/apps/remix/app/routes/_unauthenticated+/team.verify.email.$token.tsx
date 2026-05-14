declare const verifyTeamEmailToken: (token: string) => Promise<{ teamName: string; success: boolean }>;
declare const Link: (props: { to: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const CheckCircle2: (props: { className?: string }) => JSX.Element;
declare const XCircle: (props: { className?: string }) => JSX.Element;
declare const Loader: (props: { className?: string }) => JSX.Element;

export async function teamEmailVerifyLoader({ params }: { params: { token?: string } }) {
  const { token } = params;
  if (!token) {
    return { success: false, teamName: null, error: 'Token missing' };
  }
  try {
    const result = await verifyTeamEmailToken(token);
    return { success: result.success, teamName: result.teamName, error: null };
  } catch {
    return { success: false, teamName: null, error: 'Verification failed' };
  }
}

export default function TeamVerifyEmailPage({
  loaderData,
}: {
  loaderData: { success: boolean; teamName: string | null; error: string | null };
}) {
  const { success, teamName, error } = loaderData;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm text-center">
        {success ? (
          <>
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
            <h1 className="text-2xl font-bold">Email verified!</h1>
            <p className="mt-2 text-muted-foreground">
              The email address for{teamName ? <strong> {teamName}</strong> : ' your team'} has been successfully verified.
            </p>
            <Link to="/dashboard" className="mt-6 inline-block text-primary underline-offset-4 hover:underline">
              Go to dashboard
            </Link>
          </>
        ) : (
          <>
            <XCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
            <h1 className="text-2xl font-bold">Verification failed</h1>
            <p className="mt-2 text-muted-foreground">
              {error ?? 'The verification link is invalid or has expired.'}
            </p>
            <Link to="/" className="mt-6 inline-block text-primary underline-offset-4 hover:underline">
              Return home
            </Link>
          </>
        )}
      </div>
    </div>
  );
}



// [unknown-catch-variable] catch(e) — console.error(e) + boolean flag; no property access on e
declare function verifyTeamEmailToken(token: string): Promise<{ verified: boolean }>;
declare function setVerificationFailed(value: boolean): void;

async function processEmailVerification(token: string): Promise<void> {
  try {
    const result = await verifyTeamEmailToken(token);
    if (!result.verified) {
      setVerificationFailed(true);
    }
  } catch (e) {
    console.error(e);
    setVerificationFailed(true);
  }
}
