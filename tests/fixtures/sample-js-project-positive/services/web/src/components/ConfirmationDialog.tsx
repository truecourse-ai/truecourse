// ConfirmationDialog — wraps the shared UI library's modal primitive.
// @sample/ui is a monorepo-wide shared UI package, not an internal service import.
declare const Dialog: (props: { open: boolean; onOpenChange: (v: boolean) => void; children?: any }) => JSX.Element;
declare const DialogContent: (props: { children?: any }) => JSX.Element;
declare const DialogHeader: (props: { children?: any }) => JSX.Element;
declare const DialogTitle: (props: { children?: any }) => JSX.Element;
declare const DialogDescription: (props: { children?: any }) => JSX.Element;
declare const Button: (props: { onClick?: () => void; variant?: string; children?: any }) => JSX.Element;

export type ConfirmationDialogProps = {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmationDialog({
  title,
  description,
  open,
  onOpenChange,
  onConfirm,
}: ConfirmationDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Confirm</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
