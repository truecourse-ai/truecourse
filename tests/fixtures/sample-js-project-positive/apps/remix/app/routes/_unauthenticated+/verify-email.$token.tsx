declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const useNavigate: () => (path: string) => void;
declare const Link: (props: { to: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const CheckCircle2: (props: { className?: string }) => JSX.Element;
declare const XCircle: (props: { className?: string }) => JSX.Element;
declare const Loader: (props: { className?: string }) => JSX.Element;
declare const verifyEmailToken: (token: string) => Promise<{ state: 'verified' | 'already-verified' | 'expired' | 'invalid' }>;
declare const refreshSession: () => Promise<void>;
declare const match: <T>(value: T) => { with: (pattern: T, fn: () => React.ReactNode) => { otherwise: (fn: () => React.ReactNode) => React.ReactNode } };

const EMAIL_VERIFICATION_STATES = {
  verified: 'Your email has been verified.',
  'already-verified': 'This email address is already verified.',
  expired: 'This verification link has expired.',
  invalid: 'This verification link is invalid.',
} as const;

export default function VerifyEmailTokenPage({
  loaderData,
}: {
  loaderData: { token: string };
}) {
  const { token } = loaderData;
  const { toast } = useToast();
  const navigate = useNavigate();
  const [state, setState] = React.useState<keyof typeof EMAIL_VERIFICATION_STATES | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const verifyToken = async () => {
    setIsLoading(true);
    try {
      const response = await verifyEmailToken(token);
      await refreshSession();
      setState(response.state);
    } catch {
      toast({
        title: 'Verification failed',
        description: 'Something went wrong during email verification.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    void verifyToken();
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        {isLoading || state === null ? (
          <>
            <Loader className="mx-auto mb-4 h-10 w-10 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Verifying your email address...</p>
          </>
        ) : state === 'verified' || state === 'already-verified' ? (
          <>
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
            <h1 className="text-2xl font-bold">Email verified!</h1>
            <p className="mt-2 text-muted-foreground">{EMAIL_VERIFICATION_STATES[state]}</p>
            <Link
              to="/dashboard"
              className="mt-6 inline-block text-primary underline-offset-4 hover:underline"
            >
              Continue to dashboard
            </Link>
          </>
        ) : (
          <>
            <XCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
            <h1 className="text-2xl font-bold">Verification failed</h1>
            <p className="mt-2 text-muted-foreground">{EMAIL_VERIFICATION_STATES[state]}</p>
            <Link
              to="/verify-email"
              className="mt-6 inline-block text-primary underline-offset-4 hover:underline"
            >
              Request a new link
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
