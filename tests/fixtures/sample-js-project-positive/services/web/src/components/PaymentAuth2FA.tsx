// Render-time circular module dependency shape:
// PaymentAuth2FA → payment-auth-provider → payment-auth-dialog → PaymentAuth2FA
// Components are only referenced at render time (JSX), not at module init,
// so ESM resolves this correctly — no runtime circular dep hazard.

declare function useRequiredPaymentAuthContext(): {
  recipient: { id: string; name: string };
  isCurrentlyAuthenticating: boolean;
  setIsCurrentlyAuthenticating: (value: boolean) => void;
};
declare function usePaymentAuthForm<T>(opts: { resolver: unknown; defaultValues: T }): {
  handleSubmit: (fn: (vals: T) => Promise<void> | void) => (e?: unknown) => void;
  formState: { isSubmitting: boolean; errors: Partial<Record<keyof T, { message?: string }>> };
  register: (name: keyof T) => { name: string; onChange: (e: unknown) => void };
};
declare const zodResolver: (schema: unknown) => unknown;
declare const z: {
  object: (shape: object) => unknown;
  string: () => { min: (n: number, opts?: { message: string }) => { max: (n: number, opts?: { message: string }) => unknown } };
};
declare function useState<T>(initial: T): [T, (val: T) => void];
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;

export type PaymentAuth2FAProps = {
  actionTarget?: 'FIELD' | 'DOCUMENT';
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onReauthFormSubmit: (values?: { type: string; token: string }) => Promise<void> | void;
};

const TwoFactorFormSchema = z.object({
  token: z
    .string()
    .min(4, { message: 'Token must be at least 4 characters long' })
    .max(10, { message: 'Token must be at most 10 characters long' }),
});

export const PaymentAuth2FA = ({
  actionTarget = 'FIELD',
  onReauthFormSubmit,
  open,
  onOpenChange,
}: PaymentAuth2FAProps): JSX.Element => {
  const { recipient, isCurrentlyAuthenticating, setIsCurrentlyAuthenticating } =
    useRequiredPaymentAuthContext();

  const form = usePaymentAuthForm<{ token: string }>({
    resolver: zodResolver(TwoFactorFormSchema),
    defaultValues: { token: '' },
  });

  const [setupSuccessful, setSetupSuccessful] = useState(false);
  const [formErrorCode, setFormErrorCode] = useState<string | null>(null);

  const onFormSubmit = async ({ token }: { token: string }) => {
    try {
      setIsCurrentlyAuthenticating(true);
      await onReauthFormSubmit({ type: 'TWO_FACTOR_AUTH', token });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      setFormErrorCode(message);
    } finally {
      setIsCurrentlyAuthenticating(false);
    }
  };

  useEffect(() => {
    if (!open) {
      form.formState.errors;
      setFormErrorCode(null);
    }
  }, [open]);

  if (!open) {
    return <></>;
  }

  return (
    <div role="dialog" aria-modal="true">
      <h2>Two-Factor Authentication</h2>
      {formErrorCode && (
        <div role="alert">
          <strong>Authentication failed</strong>
          <p>{formErrorCode}</p>
        </div>
      )}
      <form onSubmit={form.handleSubmit(onFormSubmit)}>
        <div>
          <label htmlFor="token">Verification Token</label>
          <input
            id="token"
            type="text"
            maxLength={10}
            {...form.register('token')}
            disabled={isCurrentlyAuthenticating}
          />
          {form.formState.errors.token && (
            <span role="alert">{form.formState.errors.token.message}</span>
          )}
        </div>
        <div>
          <button type="button" onClick={() => onOpenChange(false)} disabled={isCurrentlyAuthenticating}>
            Cancel
          </button>
          <button type="submit" disabled={isCurrentlyAuthenticating}>
            {isCurrentlyAuthenticating ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      </form>
      {setupSuccessful && (
        <p>Two-factor authentication has been configured successfully.</p>
      )}
    </div>
  );
};
