import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@sample/ui/primitives/dialog';
import { Button } from '@sample/ui/primitives/button';

declare const React: { useState: <T>(init: T) => [T, (v: T) => void]; ReactNode: unknown };

export type ConfirmActionDialogProps = {
  title: string;
  description: string;
  trigger: React.ReactNode;
  onConfirm: () => Promise<void>;
};

export const ConfirmActionDialog = ({
  title,
  description,
  trigger,
  onConfirm,
}: ConfirmActionDialogProps) => {
  const [open, setOpen] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);

  const handleConfirm = async () => {
    setIsPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending ? 'Processing...' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
