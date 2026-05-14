
declare const Dialog: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }>;
declare const DialogContent: React.FC<{ children: React.ReactNode }>;
declare const DialogHeader: React.FC<{ children: React.ReactNode }>;
declare const DialogTitle: React.FC<{ children: React.ReactNode }>;
declare const DialogDescription: React.FC<{ children: React.ReactNode }>;
declare const DialogFooter: React.FC<{ children: React.ReactNode }>;

function TokenDeleteDialog({
  open,
  onOpenChange,
  tokenName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tokenName: string;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete API Token</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete the token <strong>{tokenName}</strong>? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="btn">Cancel</button>
          <button onClick={() => void onConfirm()} className="btn btn-destructive">Delete</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
