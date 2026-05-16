
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useForm: (opts: any) => any;
declare const zodResolver: (schema: any) => any;
declare const z: any;
declare const useNavigate: () => (path: string) => void;
declare const useToast: () => { toast: (opts: any) => void };
declare const Form: any;
declare const FormField: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormControl: any;
declare const FormMessage: any;
declare const Input: any;
declare const Button: any;
declare const Separator: any;
declare const Link: any;
declare const signInWithPassword: (opts: any) => Promise<{ user: any }>;
declare const signInWithOAuth: (provider: string) => Promise<void>;
declare const GoogleIcon: any;
declare const GitHubIcon: any;

const ZSignInSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export function SignInPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(ZSignInSchema),
    defaultValues: { email: '', password: '' },
  });

  const handleSubmit = form.handleSubmit(async (values: { email: string; password: string }) => {
    setIsLoading(true);
    try {
      await signInWithPassword(values);
      navigate('/dashboard');
    } catch (err: any) {
      toast({
        title: err?.message ?? 'Sign-in failed',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  });

  const handleOAuth = async (provider: string) => {
    setOauthLoading(provider);
    try {
      await signInWithOAuth(provider);
    } catch {
      toast({ title: `${provider} sign-in failed`, variant: 'destructive' });
    } finally {
      setOauthLoading(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Don\'t have an account?{' '}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create one
            </Link>
          </p>
        </div>

        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => handleOAuth('google')}
            disabled={!!oauthLoading}
            loading={oauthLoading === 'google'}
          >
            <GoogleIcon className="mr-2 h-4 w-4" />
            Continue with Google
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => handleOAuth('github')}
            disabled={!!oauthLoading}
            loading={oauthLoading === 'github'}
          >
            <GitHubIcon className="mr-2 h-4 w-4" />
            Continue with GitHub
          </Button>
        </div>

        <div className="relative my-6">
          <Separator />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">
            or
          </span>
        </div>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <FormLabel>Email address</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@company.com" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      to="/forgot-password"
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" loading={isLoading}>
              Sign in
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
