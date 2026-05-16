declare function useToast(): { toast: (opts: object) => void };
declare const authClient: { signOut: (opts: { redirectPath: string }) => Promise<void> };

interface AccountSwitcherProps {
  email?: string;
  emailRegistered?: boolean;
}

export const handleSwitchAccount = async ({ email, emailRegistered }: AccountSwitcherProps) => {
  const { toast } = useToast();

  try {
    let redirectPath = '/login';

    if (email) {
      redirectPath = emailRegistered ? `/login#email=${email}` : `/register#email=${email}`;
    }

    await authClient.signOut({
      redirectPath,
    });
  } catch {
    toast({
      title: 'Something went wrong',
      description: 'We were unable to sign you out at this time.',
      variant: 'destructive',
    });
  }
};



// FP shape: COMMON_ERROR_MESSAGES is a Record<string, { title: string; description: string }>;
// the code checks if(!message) return fallback immediately after lookup, so the undefined case is handled.
declare const COMMON_AUTH_ERROR_MESSAGES: Record<string, { title: string; description: string }>;

function getAuthErrorMessage(
  errorCode: string | null,
  fallback: { title: string; description: string },
): { title: string; description: string } {
  const message = errorCode ? COMMON_AUTH_ERROR_MESSAGES[errorCode] : undefined;
  if (!message) {
    return fallback;
  }
  return message;
}



// FP shape: access is guarded by ternary: errorParam ? ERROR_MESSAGES[errorParam] : undefined.
// Result is used as an optional value and the caller accepts undefined — deliberately allows undefined.
declare type TAuthErrorMessage = { title: string; description: string; action?: string };
declare const SIGNUP_ERROR_MESSAGES: Record<string, TAuthErrorMessage>;

function resolveSignupError(
  errorParam: string | null,
): TAuthErrorMessage | undefined {
  const signupError = errorParam ? SIGNUP_ERROR_MESSAGES[errorParam] : undefined;
  return signupError;
}

function SignupPage({ searchParams }: { searchParams: { error?: string } }) {
  const errorMessage = resolveSignupError(searchParams.error ?? null);
  return errorMessage?.title ?? 'Sign Up';
}
