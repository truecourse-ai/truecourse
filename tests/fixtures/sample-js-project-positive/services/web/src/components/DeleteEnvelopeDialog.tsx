// DeleteEnvelopeDialog — uses shared UI library primitives from @acme/ui
// @acme/ui is a workspace package whose sole purpose is cross-package UI consumption;
// all sub-paths under @acme/ui are its public API.
declare const React: { useState: <T>(init: T) => [T, (v: T) => void] };
declare function useToast(): { toast: (opts: { title: string; variant?: string }) => void };
declare function useNavigate(): (path: string) => void;
declare const Dialog: (props: { open: boolean; onOpenChange: (v: boolean) => void; children: unknown }) => JSX.Element;
declare const DialogContent: (props: { children: unknown }) => JSX.Element;
declare const DialogHeader: (props: { children: unknown }) => JSX.Element;
declare const DialogTitle: (props: { children: unknown }) => JSX.Element;
declare const DialogDescription: (props: { children: unknown }) => JSX.Element;
declare const DialogFooter: (props: { children: unknown }) => JSX.Element;
declare const Button: (props: { onClick?: () => void; disabled?: boolean; variant?: string; children: unknown }) => JSX.Element;
declare const Input: (props: { value: string; onChange: (e: { target: { value: string } }) => void; placeholder?: string }) => JSX.Element;
declare const Alert: (props: { variant?: string; children: unknown }) => JSX.Element;
declare const AlertTitle: (props: { children: unknown }) => JSX.Element;
declare const AlertDescription: (props: { children: unknown }) => JSX.Element;

export type DeleteEnvelopeDialogProps = {
  envelopeId: string;
};

export const DeleteEnvelopeDialog = ({ envelopeId }: DeleteEnvelopeDialogProps): JSX.Element => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = React.useState('');
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleDelete = async () => {
    if (!confirmText) return;
    setIsDeleting(true);
    try {
      // deletion logic would call the service API
      navigate('/envelopes');
      toast({ title: 'Envelope deleted successfully.' });
    } catch {
      toast({ title: 'Failed to delete envelope.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    Dialog({
      open: true,
      onOpenChange: () => {},
      children: DialogContent({
        children: [
          DialogHeader({
            children: [
              DialogTitle({ children: 'Delete Envelope' }),
              DialogDescription({ children: 'This action cannot be undone.' }),
            ],
          }),
          Alert({
            variant: 'destructive',
            children: [
              AlertTitle({ children: 'Warning' }),
              AlertDescription({ children: 'All signers will lose access immediately.' }),
            ],
          }),
          Input({
            value: confirmText,
            onChange: (e) => setConfirmText(e.target.value),
            placeholder: 'Type the envelope ID to confirm',
          }),
          DialogFooter({
            children: Button({
              onClick: handleDelete,
              disabled: isDeleting || confirmText !== envelopeId,
              variant: 'destructive',
              children: isDeleting ? 'Deleting…' : 'Delete',
            }),
          }),
        ],
      }),
    })
  ) as unknown as JSX.Element;
};
