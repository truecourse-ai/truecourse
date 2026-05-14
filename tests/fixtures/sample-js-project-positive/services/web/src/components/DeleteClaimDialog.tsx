
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useTranslation: () => { t: (key: string) => string };
declare const useMutation: (opts: any) => { mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean };
declare const useToast: () => { toast: (opts: any) => void };
declare const Dialog: any;
declare const DialogContent: any;
declare const DialogHeader: any;
declare const DialogTitle: any;
declare const DialogDescription: any;
declare const DialogFooter: any;
declare const Button: any;

type DeleteClaimDialogProps = {
  open: boolean;
  claimId: string;
  claimTitle: string;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
};

export const DeleteClaimDialog = ({
  open,
  claimId,
  claimTitle,
  onOpenChange,
  onDeleted,
}: DeleteClaimDialogProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();

  const { mutateAsync: deleteClaim, isPending } = useMutation({
    onSuccess: () => {
      toast({ title: t('claim.deleted'), variant: 'default' });
      onDeleted?.();
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: t('claim.deleteFailed'), variant: 'destructive' });
    },
  });

  const handleDelete = async () => {
    await deleteClaim({ claimId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteClaim.title')}</DialogTitle>
          <DialogDescription>
            {t('deleteClaim.description', { claimTitle })}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">
            {t('deleteClaim.warning')}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t('common.cancel')}
          </Button>

          <Button
            variant="destructive"
            onClick={handleDelete}
            loading={isPending}
          >
            {t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
