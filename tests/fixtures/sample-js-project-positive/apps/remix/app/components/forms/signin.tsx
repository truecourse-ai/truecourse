declare const useForm: (opts: unknown) => { register: (name: string, opts?: unknown) => unknown; handleSubmit: (fn: (data: unknown) => void) => (e: React.FormEvent) => void; formState: { errors: Record<string, { message?: string }>; isSubmitting: boolean } };
declare const Button: (props: { children: React.ReactNode; type?: string; disabled?: boolean; className?: string; variant?: string }) => JSX.Element;
declare const Input: (props: { id?: string; type?: string; placeholder?: string; className?: string; disabled?: boolean } & Record<string, unknown>) => JSX.Element;
declare const Label: (props: { htmlFor?: string; children: React.ReactNode }) => JSX.Element;
declare const Link: (props: { to: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const signInWithPasskey: () => Promise<void>;
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const cn: (...args: unknown[]) => string;

type SignInFormData = { email: string; password: string };
type SignInFormProps = { onSuccess: () => void; onSignUp: () => void };

export function SignInForm({ onSuccess, onSignUp }: SignInFormProps) {
  const { toast } = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({});
  const [isPasskeyLoading, setIsPasskeyLoading] = React.useState(false);

  const onSubmit = handleSubmit(async (data) => {
    try {
      // pretend to call sign in
      void data;
      onSuccess();
    } catch {
      toast({ title: 'Sign in failed', description: 'Check your credentials and try again.', variant: 'destructive' });
    }
  });

  const handlePasskey = async () => {
    setIsPasskeyLoading(true);
    try {
      await signInWithPasskey();
      onSuccess();
    } catch {
      toast({ title: 'Passkey failed', description: 'Passkey authentication could not be completed.', variant: 'destructive' });
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signin-email">Email address</Label>
          <Input
            id="signin-email"
            type="email"
            placeholder="you@example.com"
            disabled={isSubmitting}
            {...register('email', { required: 'Email is required' })}
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="signin-password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="signin-password"
            type="password"
            placeholder="Your password"
            disabled={isSubmitting}
            {...register('password', { required: 'Password is required' })}
          />
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
        </div>
      </div>
      <Button
        variant="outline"
        className="w-full"
        onClick={handlePasskey}
        disabled={isPasskeyLoading}
      >
        {isPasskeyLoading ? 'Authenticating...' : 'Sign in with passkey'}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Don't have an account?{' '}
        <button onClick={onSignUp} className="text-primary underline-offset-4 hover:underline">
          Sign up
        </button>
      </p>
    </div>
  );
}



// [unknown-catch-variable] multiple catch clauses — binding never accessed, fixed toast only
declare const authClient: {
  github: { signIn(opts: { redirectPath: string }): Promise<void> };
  gitlab: { signIn(opts: { redirectPath: string }): Promise<void> };
};
declare function translateMsg(msg: TemplateStringsArray, ...args: unknown[]): string;
declare const notify: (opts: { title: string; description: string; variant?: string }) => void;
declare const redirectPath: string;

async function onSignInWithGithubClick(): Promise<void> {
  try {
    await authClient.github.signIn({ redirectPath });
  } catch (err) {
    notify({
      title: translateMsg`An unknown error occurred`,
      description: translateMsg`We encountered an unknown error while signing you in. Please try again later.`,
      variant: 'destructive',
    });
  }
}

async function onSignInWithGitlabClick(): Promise<void> {
  try {
    await authClient.gitlab.signIn({ redirectPath });
  } catch (err) {
    notify({
      title: translateMsg`An unknown error occurred`,
      description: translateMsg`We encountered an unknown error while signing you in. Please try again later.`,
      variant: 'destructive',
    });
  }
}



// [unknown-catch-variable] catch(err) — AppError.parseError immediately; typed error accessed
declare const AppError: { parseError(err: unknown): { code: string; message: string } };
declare function signInWithCredentials(email: string, password: string): Promise<{ userId: string }>;
declare const signinToast: (opts: { title: string; description: string; variant?: string }) => void;
declare const ERROR_MESSAGES: Record<string, string>;

async function handleCredentialSignIn(email: string, password: string): Promise<{ userId: string } | null> {
  try {
    return await signInWithCredentials(email, password);
  } catch (err) {
    const error = AppError.parseError(err);
    const description = ERROR_MESSAGES[error.code] ?? 'An unknown error occurred. Please try again.';
    signinToast({ title: 'Sign in failed', description, variant: 'destructive' });
    return null;
  }
}
