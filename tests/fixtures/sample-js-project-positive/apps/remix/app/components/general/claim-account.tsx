
// FF36 — form.handleSubmit(onFormSubmit) react-hook-form pattern in a component
type ClaimFormValues = { username: string; password: string };
declare const claimForm: {
  handleSubmit: (onValid: (data: ClaimFormValues) => Promise<void>) => (e: Event) => void;
  register: (name: string) => { name: string; onChange: () => void };
};
declare function claimUserAccount(data: ClaimFormValues): Promise<void>;

async function onFormSubmit(data: ClaimFormValues) {
  await claimUserAccount(data);
}

const handleClaim = claimForm.handleSubmit(onFormSubmit);



// --- argument-type-mismatch FP: Zod min() with localized message string ---
declare const z: {
  string(): {
    trim(): {
      min(n: number, opts: { message: string }): ZodString;
    };
  };
};
declare function t(strings: TemplateStringsArray, ...values: unknown[]): { id: string };
declare type ZodString = { parse(val: unknown): string };

const claimFormSchema = {
  displayName: z.string().trim().min(1, { message: t`Display name is required`.id }),
  bio: z.string().trim().min(0, { message: t`Bio must be a string`.id }),
};



// [unknown-catch-variable] catch(err) — AppError.parseError immediately before property access
declare const AppError: { parseError(err: unknown): { code: string; message: string } };
declare function claimUserAccount(opts: { token: string; email: string; password: string }): Promise<{ userId: string }>;
declare const claimToast: (opts: { title: string; description: string; variant?: string }) => void;
declare const CLAIM_ERROR_MAP: Record<string, string>;

async function handleAccountClaim(token: string, email: string, password: string): Promise<boolean> {
  try {
    await claimUserAccount({ token, email, password });
    return true;
  } catch (err) {
    const error = AppError.parseError(err);
    claimToast({
      title: 'Account claim failed',
      description: CLAIM_ERROR_MAP[error.code] ?? error.message,
      variant: 'destructive',
    });
    return false;
  }
}
