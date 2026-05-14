
declare const useSigningContext10: () => { recipient: { email: string; role: string }; isDirectTemplate: boolean };
declare const useLingui10: () => { t: (strings: TemplateStringsArray, ...vals: unknown[]) => string };
declare const useToast10: () => { toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare const useState10: <T>(init: T) => [T, (v: T) => void];
declare const authClient10: { signOut: (opts: { redirectPath: string }) => Promise<void> };
declare const Alert10: React.ComponentType<{ variant?: string; children: React.ReactNode }>;
declare const AlertDescription10: React.ComponentType<{ children: React.ReactNode }>;
declare const Button10: React.ComponentType<{ type?: string; variant?: string; loading?: boolean; size?: string; onClick?: () => void; children: React.ReactNode }>;
declare const DialogFooter10: React.ComponentType<{ children: React.ReactNode }>;
declare const match10: <T>(val: T) => { with: (...args: unknown[]) => { otherwise: (fn: () => unknown) => unknown } };

type SigningAuthSwitchAccountProps = {
  actionTarget?: 'FIELD' | 'DOCUMENT';
  onOpenChange: (value: boolean) => void;
};

export const SigningAuthSwitchAccount = ({
  actionTarget = 'FIELD',
  onOpenChange,
}: SigningAuthSwitchAccountProps) => {
  const { recipient, isDirectTemplate } = useSigningContext10();
  const { t } = useLingui10();
  const { toast } = useToast10();
  const [isSwitching, setIsSwitching] = useState10(false);

  const handleSwitchAccount = async (email: string) => {
    try {
      setIsSwitching(true);

      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

      await authClient10.signOut({
        redirectPath: `/signin?returnTo=${encodeURIComponent(currentPath)}#embedded=true&email=${isDirectTemplate ? '' : email}`,
      });
    } catch {
      setIsSwitching(false);

      toast({
        title: t`Something went wrong`,
        description: t`We were unable to switch accounts at this time.`,
        duration: 10000,
        variant: 'destructive',
      });
    }
  };

  const getMessage = () => {
    return match10({ role: recipient.role, actionTarget })
      .with({ role: 'SIGNER', actionTarget: 'FIELD' }, () =>
        isDirectTemplate
          ? t`To sign this field, you need to be logged in.`
          : t`To sign this field, log in as ${recipient.email}`,
      )
      .with({ role: 'SIGNER', actionTarget: 'DOCUMENT' }, () =>
        isDirectTemplate
          ? t`To sign this document, you need to be logged in.`
          : t`To sign this document, log in as ${recipient.email}`,
      )
      .otherwise(() => t`Authentication required`);
  };

  return (
    <fieldset disabled={isSwitching} className="space-y-4">
      <Alert10 variant="warning">
        <AlertDescription10>
          <span>{getMessage() as string}</span>
        </AlertDescription10>
      </Alert10>

      <DialogFooter10>
        <Button10 type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          {t`Cancel`}
        </Button10>
        <Button10
          type="button"
          loading={isSwitching}
          onClick={() => handleSwitchAccount(recipient.email)}
        >
          {t`Switch account`}
        </Button10>
      </DialogFooter10>
    </fieldset>
  );
};



declare const useEnvelopeSigningCtx17: () => { envelopeData: { settings: { brandingEnabled: boolean; brandingLogo?: string } }; envelope: { teamId: number; team: { name: string }; title: string }; recipientFieldsRemaining: unknown[]; recipient: { role: string } };
declare const useEmbedCtx17: () => unknown | null;
declare const Link17: React.ComponentType<{ to: string; className?: string; children: React.ReactNode }>;
declare const Separator17: React.ComponentType<{ orientation?: string; className?: string }>;
declare const Badge17: React.ComponentType<{ children: React.ReactNode }>;
declare const Button17: React.ComponentType<{ variant?: string; asChild?: boolean; children: React.ReactNode }>;
declare const DropdownMenu17: React.ComponentType<{ children: React.ReactNode }>;
declare const DropdownMenuTrigger17: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const DropdownMenuContent17: React.ComponentType<{ children: React.ReactNode }>;
declare const DropdownMenuItem17: React.ComponentType<{ onClick?: () => void; children: React.ReactNode }>;
declare const BrandingLogo17: React.ComponentType<{ className?: string }>;
declare const BrandingLogoIcon17: React.ComponentType<{ className?: string }>;
declare const EnvelopeCompleteDialog17: React.ComponentType;
declare const EnvelopeDownloadDialog17: React.ComponentType<{ envelopeId: number }>;
declare const DocumentRejectDialog17: React.ComponentType;
declare const BanIcon17: React.ComponentType<{ className?: string }>;
declare const DownloadCloudIcon17: React.ComponentType<{ className?: string }>;
declare const match17: <T>(val: T) => { with: (...args: unknown[]) => { otherwise: (fn: () => unknown) => unknown } };
declare const RecipientRole17: { VIEWER: string; SIGNER: string; APPROVER: string; ASSISTANT: string };

export const SignerNavigationHeader17 = () => {
  const { envelopeData, envelope, recipientFieldsRemaining, recipient } = useEnvelopeSigningCtx17();
  const isEmbedded = useEmbedCtx17() !== null;

  return (
    <nav className="embed--SignerWidgetHeader flex max-w-screen flex-row justify-between border-border border-b bg-background px-4 py-3 md:px-6">
      <div className="flex min-w-0 flex-1 items-center space-x-2 md:w-auto md:flex-none">
        {!isEmbedded && (
          <Link17 to="/" className="flex-shrink-0">
            {envelopeData.settings.brandingEnabled && envelopeData.settings.brandingLogo ? (
              <img
                src={`/api/branding/logo/team/${envelope.teamId}`}
                alt={`${envelope.team.name}'s Logo`}
                className="h-6 w-auto"
              />
            ) : (
              <>
                <BrandingLogo17 className="hidden h-6 w-auto md:block" />
                <BrandingLogoIcon17 className="h-6 w-auto md:hidden" />
              </>
            )}
          </Link17>
        )}

        <h1 title={envelope.title} className="min-w-0 truncate font-semibold text-base text-foreground md:hidden">
          {envelope.title}
        </h1>

        {!isEmbedded && <Separator17 orientation="vertical" className="hidden h-6 md:block" />}

        <div className="hidden items-center space-x-2 md:flex">
          <h1 className="whitespace-nowrap font-medium text-foreground text-sm">{envelope.title}</h1>

          <Badge17>
            {match17(recipient.role)
              .with(RecipientRole17.VIEWER, () => 'Viewer')
              .with(RecipientRole17.SIGNER, () => 'Signer')
              .with(RecipientRole17.APPROVER, () => 'Approver')
              .with(RecipientRole17.ASSISTANT, () => 'Assistant')
              .otherwise(() => null) as React.ReactNode}
          </Badge17>
        </div>
      </div>

      <div className="hidden items-center space-x-2 lg:flex">
        <p className="mr-2 flex-shrink-0 text-muted-foreground text-sm">
          {(recipientFieldsRemaining as unknown[]).length === 1
            ? '1 Field Remaining'
            : `${(recipientFieldsRemaining as unknown[]).length} Fields Remaining`}
        </p>

        <EnvelopeCompleteDialog17 />
      </div>

      <div className="flex items-center space-x-2 lg:hidden">
        <DropdownMenu17>
          <DropdownMenuTrigger17 asChild>
            <Button17 variant="ghost">Menu</Button17>
          </DropdownMenuTrigger17>
          <DropdownMenuContent17>
            <DropdownMenuItem17>
              <EnvelopeDownloadDialog17 envelopeId={0} />
            </DropdownMenuItem17>
            <DropdownMenuItem17>
              <DocumentRejectDialog17 />
            </DropdownMenuItem17>
          </DropdownMenuContent17>
        </DropdownMenu17>
      </div>
    </nav>
  );
};



declare const AppError29: { parseError: (err: unknown) => { code: string; message?: string } };
declare const DocumentAuth29: { TWO_FACTOR_AUTH: string };
declare const z29: { object: (s: unknown) => { min: never } & unknown; string: () => { min: (n: number, opts?: unknown) => { max: (n: number, opts?: unknown) => unknown } } };
declare const useForm29: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => Promise<void>) => (e: unknown) => void; control: unknown; reset: () => void; formState: { isSubmitting: boolean } };
declare const zodResolver29: (schema: unknown) => unknown;
declare const useEffect29: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useState29: <T>(init: T) => [T, (v: T) => void];
declare const useRequiredSigningCtx29: () => { recipient: { email: string; role: string }; user: { id: number } | null; isCurrentlyAuthenticating: boolean; setIsCurrentlyAuthenticating: (v: boolean) => void };
declare const Enable2FADialog29: React.ComponentType<{ onSuccess: () => void }>;
declare const Alert29: React.ComponentType<{ variant?: string; children: React.ReactNode }>;
declare const AlertTitle29: React.ComponentType<{ children: React.ReactNode }>;
declare const AlertDescription29: React.ComponentType<{ children: React.ReactNode }>;
declare const Button29: React.ComponentType<{ type?: string; variant?: string; loading?: boolean; disabled?: boolean; size?: string; onClick?: () => void; children: React.ReactNode }>;
declare const DialogFooter29: React.ComponentType<{ children: React.ReactNode }>;
declare const Form29: React.ComponentType<{ form: unknown; onSubmit: (e: unknown) => void; children: React.ReactNode }>;
declare const FormField29: React.ComponentType<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem29: React.ComponentType<{ children: React.ReactNode }>;
declare const FormLabel29: React.ComponentType<{ children: React.ReactNode }>;
declare const FormControl29: React.ComponentType<{ children: React.ReactNode }>;
declare const FormMessage29: React.ComponentType;
declare const PinInput29: React.ComponentType<{ className?: string; children: React.ReactNode }>;
declare const PinInputGroup29: React.ComponentType<{ children: React.ReactNode }>;
declare const PinInputSlot29: React.ComponentType<{ index: number }>;
declare const RecipientRole29: { SIGNER: string; APPROVER: string };
declare const match29: <T>(val: T) => { with: (...args: unknown[]) => { otherwise: (fn: () => unknown) => unknown } };

const ZAuthTokenSchema29 = { schema: null as unknown };

type Auth2FAProps29 = {
  actionTarget?: 'FIELD' | 'DOCUMENT';
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onReauthFormSubmit: (values?: { type: string; token: string }) => Promise<void> | void;
};

const ZTOTPSchema29 = { token: { min: 4, max: 10 } };

export const SigningAuth2FAWidget29 = ({
  actionTarget = 'FIELD',
  onReauthFormSubmit,
  open,
  onOpenChange,
}: Auth2FAProps29) => {
  const { recipient, user, isCurrentlyAuthenticating, setIsCurrentlyAuthenticating } = useRequiredSigningCtx29();

  const Z2FA29 = (z29 as unknown as { object: (s: unknown) => unknown }).object({
    token: (z29.string() as unknown as { min: (n: number, opts?: unknown) => { max: (n: number, opts?: unknown) => unknown } })
      .min(4, { message: 'Token must be at least 4 characters' })
      .max(10, { message: 'Token must be at most 10 characters' }),
  });

  type T2FA29 = { token: string };

  const form = useForm29<T2FA29>({
    resolver: zodResolver29(Z2FA29),
    defaultValues: { token: '' },
  });

  const [setup2FASuccess, setSetup2FASuccess] = useState29(false);
  const [formError, setFormError] = useState29<string | null>(null);

  const onSubmit = async ({ token }: T2FA29) => {
    try {
      setIsCurrentlyAuthenticating(true);
      await onReauthFormSubmit({ type: DocumentAuth29.TWO_FACTOR_AUTH, token });
      onOpenChange(false);
    } catch (err) {
      setIsCurrentlyAuthenticating(false);
      const error = AppError29.parseError(err);
      setFormError(error.message ?? 'Authentication failed');
    }
  };

  useEffect29(() => {
    if (!open) {
      form.reset();
      setFormError(null);
      setSetup2FASuccess(false);
    }
  }, [open]);

  return (
    <div className="space-y-4">
      {formError && (
        <Alert29 variant="destructive">
          <AlertTitle29>Verification failed</AlertTitle29>
          <AlertDescription29>{formError}</AlertDescription29>
        </Alert29>
      )}

      {user && !user.id && (
        <Enable2FADialog29 onSuccess={() => setSetup2FASuccess(true)} />
      )}

      <Form29 form={form} onSubmit={form.handleSubmit(onSubmit)}>
        <FormField29
          control={form.control}
          name="token"
          render={({ field }) => (
            <FormItem29>
              <FormLabel29>Authentication code</FormLabel29>
              <FormControl29>
                <PinInput29 className="flex justify-center" {...(field as object)}>
                  <PinInputGroup29>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <PinInputSlot29 key={i} index={i} />
                    ))}
                  </PinInputGroup29>
                </PinInput29>
              </FormControl29>
              <FormMessage29 />
            </FormItem29>
          )}
        />

        <DialogFooter29>
          <Button29 type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button29>
          <Button29 type="submit" loading={isCurrentlyAuthenticating} disabled={isCurrentlyAuthenticating}>
            Verify
          </Button29>
        </DialogFooter29>
      </Form29>
    </div>
  );
};
