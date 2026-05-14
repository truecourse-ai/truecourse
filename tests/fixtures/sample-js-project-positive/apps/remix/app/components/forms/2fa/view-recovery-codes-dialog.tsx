declare const Dialog: (props: { open?: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const DialogContent: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const DialogHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const DialogFooter: (props: { children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; variant?: string; disabled?: boolean }) => JSX.Element;
declare const downloadTextFile: (filename: string, content: string) => void;
declare const copyToClipboard: (text: string) => Promise<void>;
declare const useToast: () => { toast: (opts: { title: string }) => void };

type ViewRecoveryCodesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recoveryCodes: string[];
};

export function ViewRecoveryCodesDialog({
  open,
  onOpenChange,
  recoveryCodes,
}: ViewRecoveryCodesDialogProps) {
  const { toast } = useToast();
  const [isCopied, setIsCopied] = React.useState(false);

  const handleCopy = async () => {
    await copyToClipboard(recoveryCodes.join('\n'));
    setIsCopied(true);
    toast({ title: 'Recovery codes copied to clipboard' });
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    downloadTextFile('recovery-codes.txt', recoveryCodes.join('\n'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Recovery codes</DialogTitle>
          <DialogDescription>
            Store these codes somewhere safe. Each code can only be used once.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-muted p-4">
          <div className="grid grid-cols-2 gap-2">
            {recoveryCodes.map((code) => (
              <code key={code} className="block font-mono text-sm">
                {code}
              </code>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Keep these codes in a password manager or printed document. You can use them to access your
          account if you lose your authentication device.
        </p>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={handleDownload}>
            Download
          </Button>
          <Button onClick={handleCopy}>{isCopied ? 'Copied!' : 'Copy codes'}</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
