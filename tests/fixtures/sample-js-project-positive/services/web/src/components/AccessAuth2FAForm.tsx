
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useForm: (opts: any) => any;
declare const zodResolver: (schema: any) => any;
declare const z: any;
declare const useMutation: (opts: any) => { mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean };
declare const useToast: () => { toast: (opts: any) => void };
declare const Form: any;
declare const FormField: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormControl: any;
declare const FormMessage: any;
declare const Input: any;
declare const Button: any;
declare const RadioGroup: any;
declare const RadioGroupItem: any;
declare const Label: any;
declare const Smartphone: any;
declare const Mail: any;

type FormStep = 'method-selection' | 'code-input';
type TwoFactorMethod = 'email' | 'authenticator';

const ZTwoFactorCodeSchema = z.object({
  token: z.string().length(6, { message: 'Code must be exactly 6 digits' }),
});

type TwoFactorCodeValues = z.infer<typeof ZTwoFactorCodeSchema>;

type AccessAuth2FAFormProps = {
  onSubmit: (token: string) => void;
  accessToken: string;
  hasAuthenticator: boolean;
  error?: string | null;
};

export const AccessAuth2FAForm = ({
  onSubmit,
  accessToken,
  hasAuthenticator,
  error,
}: AccessAuth2FAFormProps) => {
  const { toast } = useToast();
  const [step, setStep] = useState<FormStep>('method-selection');
  const [selectedMethod, setSelectedMethod] = useState<TwoFactorMethod | null>(null);

  const form = useForm({
    resolver: zodResolver(ZTwoFactorCodeSchema),
    defaultValues: { token: '' },
  });

  const { mutateAsync: requestEmailCode, isPending: isSendingCode } = useMutation({
    onSuccess: () => {
      setStep('code-input');
      toast({ title: 'Verification code sent to your email' });
    },
    onError: () => {
      toast({ title: 'Failed to send code', variant: 'destructive' });
    },
  });

  const handleMethodSelect = async (method: TwoFactorMethod) => {
    setSelectedMethod(method);

    if (method === 'email') {
      await requestEmailCode({ accessToken });
    } else {
      setStep('code-input');
    }
  };

  const handleSubmit = form.handleSubmit((values: TwoFactorCodeValues) => {
    onSubmit(values.token);
  });

  if (step === 'method-selection') {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Two-factor authentication</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose how to verify your identity.
          </p>
        </div>

        <RadioGroup onValueChange={(v: TwoFactorMethod) => handleMethodSelect(v)} className="space-y-3">
          <label
            htmlFor="method-email"
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 hover:bg-muted/40"
          >
            <RadioGroupItem id="method-email" value="email" className="mt-0.5" />
            <div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                <Label className="cursor-pointer font-medium">Email code</Label>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Receive a code at your registered email address.
              </p>
            </div>
          </label>

          {hasAuthenticator && (
            <label
              htmlFor="method-authenticator"
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 hover:bg-muted/40"
            >
              <RadioGroupItem id="method-authenticator" value="authenticator" className="mt-0.5" />
              <div>
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4" />
                  <Label className="cursor-pointer font-medium">Authenticator app</Label>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Use your authenticator app to generate a code.
                </p>
              </div>
            </label>
          )}
        </RadioGroup>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Enter verification code</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedMethod === 'email'
              ? 'Enter the 6-digit code sent to your email.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </p>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <FormField
          control={form.control}
          name="token"
          render={({ field }: { field: any }) => (
            <FormItem>
              <FormLabel>Verification code</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  autoFocus
                  className="font-mono text-lg tracking-[0.5em]"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setStep('method-selection')}
          >
            Back
          </Button>

          <Button type="submit">
            Verify
          </Button>
        </div>
      </form>
    </Form>
  );
};


// --- argument-type-mismatch FP: getAssetUrl() returns string; Img src accepts string ---
// getAssetUrl('/static/logo.png') returns a valid string URL — no type mismatch with src prop.
declare function getAssetUrl2(path: string): string;
declare function Img(props: { src: string; alt: string; className?: string }): JSX.Element;
declare const orgBrandingLogo: string | null;
declare const orgBrandingEnabled: boolean;

function renderOrgLogo(): JSX.Element {
  if (orgBrandingEnabled && orgBrandingLogo) {
    return <Img src={orgBrandingLogo} alt="Organisation Logo" className="mb-4 h-6" />;
  }

  return <Img src={getAssetUrl2('/static/app-logo.png')} alt="App Logo" className="mb-4 h-6" />;
}



// argument-type-mismatch: passes number where string expected — genuine TS2345
function formatOtpCode(code: string, groupSize: number): string {
  return code.match(new RegExp(`.{1,${groupSize}}`, 'g'))?.join('-') ?? code;
}
// TS2345: Argument of type 'boolean' is not assignable to parameter of type 'string'
const _otpFormatted = formatOtpCode(true, 3);

