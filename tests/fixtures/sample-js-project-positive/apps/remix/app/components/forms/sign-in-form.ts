
// Log then parseError: console.log(err) then TypedErrorParser.parseError(err) for typed access
declare const TypedErrorParser: { parseError(e: unknown): { code: string; message: string } };
declare function showNotification(opts: { title: string; variant: string }): void;
declare function performSignIn(credentials: { email: string; password: string }): Promise<{ token: string }>;

async function handleSignIn(email: string, password: string): Promise<void> {
  try {
    const { token } = await performSignIn({ email, password });
    storeAuthToken(token);
  } catch (err) {
    console.log(err);
    const error = TypedErrorParser.parseError(err);
    if (error.code === 'INVALID_CREDENTIALS') {
      showNotification({ title: 'Invalid email or password', variant: 'destructive' });
    } else {
      showNotification({ title: 'Sign-in failed', variant: 'destructive' });
    }
  }
}

declare function storeAuthToken(token: string): void;
