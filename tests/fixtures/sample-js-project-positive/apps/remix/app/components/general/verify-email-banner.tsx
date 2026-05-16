declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; className?: string }) => JSX.Element;
declare const Alert: (props: { children: React.ReactNode; variant?: string; className?: string }) => JSX.Element;
declare const AlertTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const AlertDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const AlertTriangle: (props: { className?: string }) => JSX.Element;
declare const resendVerificationEmail: (email: string) => Promise<void>;

type EmailVerificationBannerProps = {
  email: string;
};

export function EmailVerificationBanner({ email }: EmailVerificationBannerProps) {
  const { toast } = useToast();
  const [isSending, setIsSending] = React.useState(false);
  const [lastSentAt, setLastSentAt] = React.useState<number | null>(null);

  const RESEND_COOLDOWN_MS = 20_000;

  const isButtonDisabled =
    isSending || (lastSentAt !== null && Date.now() - lastSentAt < RESEND_COOLDOWN_MS);

  const handleResend = async () => {
    if (isButtonDisabled) return;
    setIsSending(true);
    try {
      await resendVerificationEmail(email);
      setLastSentAt(Date.now());
      toast({
        title: 'Verification email sent',
        description: 'Please check your inbox for a verification link.',
      });
    } catch {
      toast({
        title: 'Failed to send email',
        description: 'Something went wrong. Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Alert variant="warning" className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <div>
          <AlertTitle>Email not verified</AlertTitle>
          <AlertDescription className="text-sm">
            Please verify your email address <strong>{email}</strong> to access all features.
          </AlertDescription>
        </div>
      </div>
      <Button
        variant="outline"
        onClick={handleResend}
        disabled={isButtonDisabled}
        className="shrink-0"
      >
        {isSending ? 'Sending...' : 'Resend email'}
      </Button>
    </Alert>
  );
}
