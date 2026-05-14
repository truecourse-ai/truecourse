
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useTranslation: () => { t: (key: string, opts?: any) => string };
declare const useNavigate: () => (path: string) => void;
declare const Dialog: any;
declare const DialogContent: any;
declare const DialogHeader: any;
declare const DialogTitle: any;
declare const DialogDescription: any;
declare const Button: any;
declare const CheckCircle: any;
declare const Download: any;
declare const Share2: any;

type SigningCompleteDialogProps = {
  open: boolean;
  documentTitle: string;
  downloadUrl?: string;
  onOpenChange: (open: boolean) => void;
};

export const SigningCompleteDialog = ({
  open,
  documentTitle,
  downloadUrl,
  onOpenChange,
}: SigningCompleteDialogProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [copySuccess, setCopySuccess] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // clipboard API may be blocked
    }
  };

  const handleGoToDashboard = () => {
    navigate('/dashboard');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="items-center text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
            <CheckCircle className="h-8 w-8" />
          </div>

          <DialogTitle>{t('signing.complete.title')}</DialogTitle>

          <DialogDescription>
            {t('signing.complete.description', { documentTitle })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 pt-2">
          {downloadUrl && (
            <Button
              asChild
              variant="default"
              className="w-full"
            >
              <a href={downloadUrl} download>
                <Download className="mr-2 h-4 w-4" />
                {t('signing.complete.download')}
              </a>
            </Button>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={handleCopyLink}
          >
            <Share2 className="mr-2 h-4 w-4" />
            {copySuccess ? t('common.copied') : t('signing.complete.share')}
          </Button>

          <Button
            variant="ghost"
            className="w-full"
            onClick={handleGoToDashboard}
          >
            {t('signing.complete.dashboard')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
