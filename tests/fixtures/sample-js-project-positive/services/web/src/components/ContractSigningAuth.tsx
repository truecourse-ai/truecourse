// --- cross-service-internal-import FP: shared UI library subpath import ---
// Imports from @sample/ui/primitives/dialog are false positives: @sample/ui is a
// public shared UI library package in the monorepo, not an internal layer of a
// bounded service. The rule fires because the subpath looks like an internal
// module of a sibling service, but the package is a shared primitive library.

declare const Alert: React.ComponentType<{ children?: React.ReactNode }>;
declare const AlertDescription: React.ComponentType<{ children?: React.ReactNode }>;
declare const AlertTitle: React.ComponentType<{ children?: React.ReactNode }>;
declare const Button: React.ComponentType<{ type?: string; disabled?: boolean; onClick?: () => void; children?: React.ReactNode }>;
declare const DialogFooter: React.ComponentType<{ children?: React.ReactNode }>;
declare const Form: React.ComponentType<{ children?: React.ReactNode; onSubmit?: (e: unknown) => void }>;
declare const FormControl: React.ComponentType<{ children?: React.ReactNode }>;
declare const FormField: React.ComponentType<{ name: string; children: React.ReactNode }>;
declare const FormItem: React.ComponentType<{ children?: React.ReactNode }>;
declare const FormLabel: React.ComponentType<{ children?: React.ReactNode }>;
declare const FormMessage: React.ComponentType<{ children?: React.ReactNode }>;
declare const Input: React.ComponentType<{ type?: string; disabled?: boolean; placeholder?: string }>;
declare function useContractSigningAuthContext(): {
  signer: { id: string; email: string };
  isCurrentlyAuthenticating: boolean;
  setIsCurrentlyAuthenticating: (value: boolean) => void;
};
declare function useForm<T>(opts: { resolver: unknown; defaultValues: T }): {
  handleSubmit: (fn: (vals: T) => Promise<void> | void) => (e?: unknown) => void;
  control: unknown;
  formState: { isSubmitting: boolean; errors: Partial<Record<keyof T, { message?: string }>> };
};
declare const zodResolver: (schema: unknown) => unknown;
declare const z: {
  object: (shape: object) => unknown;
  string: () => { min: (n: number, opts?: { message: string }) => { max: (n: number, opts?: { message: string }) => unknown } };
  infer: unknown;
};
declare function useState<T>(initial: T): [T, (val: T) => void];
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;

export type ContractSigningAuthPasswordProps = {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onReauthFormSubmit: (values?: { type: string; password: string }) => Promise<void> | void;
};

const ZPasswordAuthFormSchema = z.object({
  password: (z.string() as any)
    .min(1, { message: 'Password is required' })
    .max(72, { message: 'Password must be at most 72 characters long' }),
});

export const ContractSigningAuthPassword = ({
  onReauthFormSubmit,
  open,
  onOpenChange,
}: ContractSigningAuthPasswordProps): JSX.Element => {
  const { signer, isCurrentlyAuthenticating, setIsCurrentlyAuthenticating } =
    useContractSigningAuthContext();

  const [formErrorCode, setFormErrorCode] = useState<string | null>(null);

  const form = useForm<{ password: string }>({
    resolver: zodResolver(ZPasswordAuthFormSchema),
    defaultValues: { password: '' },
  });

  const onFormSubmit = async ({ password }: { password: string }) => {
    try {
      setIsCurrentlyAuthenticating(true);
      await onReauthFormSubmit({ type: 'PASSWORD', password });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      setFormErrorCode(message);
    } finally {
      setIsCurrentlyAuthenticating(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setFormErrorCode(null);
    }
  }, [open]);

  if (!open) {
    return <></>;
  }

  return (
    <div role="dialog" aria-modal="true">
      <h2>Authenticate to Sign</h2>
      <p>Signing as: {signer.email}</p>
      {formErrorCode && (
        <Alert>
          <AlertTitle>Authentication failed</AlertTitle>
          <AlertDescription>{formErrorCode}</AlertDescription>
        </Alert>
      )}
      <Form onSubmit={form.handleSubmit(onFormSubmit)}>
        <FormField name="password">
          <FormItem>
            <FormLabel>Password</FormLabel>
            <FormControl>
              <Input type="password" disabled={isCurrentlyAuthenticating} placeholder="Enter your password" />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>
        <DialogFooter>
          <Button type="button" disabled={isCurrentlyAuthenticating} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isCurrentlyAuthenticating}>
            {isCurrentlyAuthenticating ? 'Verifying…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </Form>
    </div>
  );
};
