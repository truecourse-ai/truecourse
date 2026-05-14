// DocumentDeleteDialog — uses shared UI library primitives via @sample/ui subpath
// The import specifier matches `@<scope>/ui/primitives/...` which is a public
// shared UI library, not a cross-service internal import.

declare const React: { useState: (init: boolean) => [boolean, (v: boolean) => void] };

declare function useDocumentLimits(): { canDeleteDocument: boolean; remainingDeletes: number };
declare function useAppToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };

declare const Button: React.FC<{ onClick?: () => void; disabled?: boolean; variant?: string; children: React.ReactNode }>;
declare const Alert: React.FC<{ children: React.ReactNode }>;
declare const AlertDescription: React.FC<{ children: React.ReactNode }>;
declare const Input: React.FC<{ value: string; onChange: (e: { target: { value: string } }) => void; placeholder?: string }>;
declare const Dialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }>;
declare const DialogContent: React.FC<{ children: React.ReactNode }>;
declare const DialogHeader: React.FC<{ children: React.ReactNode }>;
declare const DialogTitle: React.FC<{ children: React.ReactNode }>;
declare const DialogDescription: React.FC<{ children: React.ReactNode }>;
declare const DialogFooter: React.FC<{ children: React.ReactNode }>;
declare const DialogClose: React.FC<{ asChild?: boolean; children: React.ReactNode }>;
declare const DialogTrigger: React.FC<{ asChild?: boolean; children: React.ReactNode }>;

type DocumentDeleteDialogProps = {
  documentId: string;
  documentTitle: string;
  trigger?: React.ReactNode;
  onDeleted?: () => void;
  canManage: boolean;
};

export function DocumentDeleteDialog({
  documentId,
  documentTitle,
  trigger,
  onDeleted,
  canManage,
}: DocumentDeleteDialogProps): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [confirmTitle, setConfirmTitle] = React.useState('');
  const { canDeleteDocument } = useDocumentLimits();
  const { toast } = useAppToast();

  const titleMatches = confirmTitle === documentTitle;

  async function handleDelete() {
    if (!titleMatches || !canManage) return;
    try {
      // deletion logic omitted — orchestrator fills in
      toast({ title: 'Document deleted', variant: 'default' });
      setOpen(false);
      onDeleted?.();
    } catch {
      toast({ title: 'Failed to delete document', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete document</DialogTitle>
          <DialogDescription>
            This action cannot be undone. Type <strong>{documentTitle}</strong> to confirm.
          </DialogDescription>
        </DialogHeader>

        {!canDeleteDocument && (
          <Alert>
            <AlertDescription>You have reached your document deletion limit.</AlertDescription>
          </Alert>
        )}

        <Input
          value={confirmTitle}
          onChange={(e) => setConfirmTitle(e.target.value)}
          placeholder={documentTitle}
        />

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={handleDelete}
            disabled={!titleMatches || !canManage || !canDeleteDocument}
            variant="destructive"
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
