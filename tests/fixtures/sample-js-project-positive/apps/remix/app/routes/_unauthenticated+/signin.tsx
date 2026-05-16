
declare function useLoaderDataTyped3<T>(): T;
declare function useNavigate2(): (path: string) => void;

export default function SignInPage() {
  const { callbackUrl, error } = useLoaderDataTyped3<{ callbackUrl: string; error: string | null }>();
  const navigate = useNavigate2();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = form.get('email') as string;
    void fetch('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email, callbackUrl }),
    }).then(() => navigate(callbackUrl));
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">Sign In</h1>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <input name="email" type="email" placeholder="Email" className="input" required />
        <button type="submit" className="btn btn-primary w-full">Continue</button>
      </form>
    </div>
  );
}



declare const useLingui4: () => { _: (msg: unknown) => string };
declare const useSearchParams5: () => [URLSearchParams, unknown];
declare const useState6: <T>(v: T) => [T, (v: T) => void];
declare const useEffect2: (fn: () => void | (() => void), deps?: unknown[]) => void;
declare const SignInForm2: React.FC<{ isGoogleSSOEnabled: boolean; isMicrosoftSSOEnabled: boolean; isOIDCSSOEnabled: boolean; oidcProviderLabel?: string; returnTo?: string }>;
declare const Alert2: React.FC<{ variant?: string; className?: string; children?: React.ReactNode }>;
declare const AlertDescription2: React.FC<{ children?: React.ReactNode }>;
declare const Link5: React.FC<{ to: string; className?: string; children?: React.ReactNode }>;
declare const SIGNUP_ERROR_MESSAGES2: Record<string, unknown>;
declare const React: { FC: unknown; ReactNode: unknown };

type SignInLoaderData = {
  isGoogleSSOEnabled: boolean;
  isMicrosoftSSOEnabled: boolean;
  isOIDCSSOEnabled: boolean;
  isSignupEnabled: boolean;
  oidcProviderLabel?: string;
  returnTo?: string;
};

export default function SignIn2({ loaderData }: { loaderData: SignInLoaderData }) {
  const { isGoogleSSOEnabled, isMicrosoftSSOEnabled, isOIDCSSOEnabled, isSignupEnabled, oidcProviderLabel, returnTo } =
    loaderData;

  const { _ } = useLingui4();
  const [searchParams] = useSearchParams5();
  const [isEmbeddedRedirect, setIsEmbeddedRedirect] = useState6(false);

  const errorParam = searchParams.get('error');
  const signupError = errorParam ? SIGNUP_ERROR_MESSAGES2[errorParam] : undefined;

  useEffect2(() => {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    setIsEmbeddedRedirect(params.get('embedded') === 'true');
  }, []);

  return (
    <div className="w-screen max-w-lg px-4">
      <div className="z-10 rounded-xl border border-border bg-neutral-100 p-6 dark:bg-background">
        {signupError && (
          <Alert2 variant="destructive" className="mb-4">
            <AlertDescription2>{_(signupError as unknown)}</AlertDescription2>
          </Alert2>
        )}

        <h1 className="font-semibold text-2xl">Sign in to your account</h1>

        <p className="mt-2 text-muted-foreground text-sm">
          Welcome back, we are lucky to have you.
        </p>

        <hr className="-mx-6 my-4" />

        <SignInForm2
          isGoogleSSOEnabled={isGoogleSSOEnabled}
          isMicrosoftSSOEnabled={isMicrosoftSSOEnabled}
          isOIDCSSOEnabled={isOIDCSSOEnabled}
          oidcProviderLabel={oidcProviderLabel}
          returnTo={returnTo}
        />

        {!isEmbeddedRedirect && isSignupEnabled && (
          <p className="mt-6 text-center text-muted-foreground text-sm">
            Don't have an account?{' '}
            <Link5
              to={returnTo ? `/signup?returnTo=${encodeURIComponent(returnTo)}` : '/signup'}
              className="text-primary duration-200 hover:opacity-70"
            >
              Sign up
            </Link5>
          </p>
        )}
      </div>
    </div>
  );
}
